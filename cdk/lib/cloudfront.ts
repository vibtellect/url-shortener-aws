import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';

const HOSTED_ZONE_ID = 'Z082763925ZHY096CNVOQ';
const ZONE_NAME = 'vibtellect.de';

interface CloudFrontStackProps extends cdk.StackProps {
  certArn: string;
  domainName: string;
}

export class CloudFrontStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, props);

    const certificate = certificatemanager.Certificate.fromCertificateArn(this, 'Certificate', props.certArn);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: ZONE_NAME
    });

    const apiEndpoint = cdk.Fn.importValue('UrlShortenerApiEndpointV2');
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', apiEndpoint));

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(websiteBucket, {
      originAccessControl: new cloudfront.S3OriginAccessControl(this, 'OAC', {
        signing: cloudfront.Signing.SIGV4_ALWAYS,
      }),
    });

    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
    });

    const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      defaultRootObject: 'index.html',
      certificate,
      domainNames: [props.domainName],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'URL Shortener - CloudFront',
      errorResponses: [{
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: cdk.Duration.minutes(5),
      }],
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: {
        '/create': {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        '/metrics': {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        '/s/*': {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        ...this.createStaticFileBehaviors(s3Origin),
      },
    });

    new route53.ARecord(this, 'AliasRecord', {
      zone: hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('../frontend')],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });
  }

  private createStaticFileBehaviors(s3Origin: cloudfront.IOrigin): Record<string, cloudfront.BehaviorOptions> {
    const extensions = ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.css', '*.js', '*.ico'];
    return Object.fromEntries(
      extensions.map(ext => [ext, {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      }])
    );
  }
}
