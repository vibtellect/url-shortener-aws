import { dirname } from 'path';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Runtime, Function as LambdaFunction, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnhancedMonitoring } from './constructs/enhanced-monitoring';

const DOMAIN_NAME = 'url-shortener.vibtellect.de';
const CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:440744214189:certificate/db6b1dd5-9cf5-48dd-bee1-e65036700312';

export class UrlShortenerStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const __dirname = dirname(__filename);

    const certificate = certificatemanager.Certificate.fromCertificateArn(
      this,
      'Certificate',
      CERTIFICATE_ARN
    );

    const domainName = new apigatewayv2.DomainName(this, 'CustomDomain', {
      domainName: DOMAIN_NAME,
      certificate,
    });

    const table = new Table(this, 'UrlTable', {
      partitionKey: { name: 'short_code', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const lambdaFn = new LambdaFunction(this, 'ShortenerLambda', {
      runtime: Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(path.join(__dirname, '../../go'), {
        bundling: {
          image: Runtime.PROVIDED_AL2023.bundlingImage,
          command: [
            'bash', '-c',
            [
              'mkdir -p /tmp/.cache',
              'export GOCACHE=/tmp/.cache',
              'export GOARCH=arm64',
              'export GOOS=linux',
              'go build -o /asset-output/bootstrap .',
            ].join(' && '),
          ],
          user: 'root',
        },
      }),
      environment: {
        DYNAMODB_TABLE: table.tableName,
        BASE_URL: `https://${DOMAIN_NAME}`,
      },
      memorySize: 128,
      timeout: Duration.seconds(5),
    });

    table.grantReadWriteData(lambdaFn);

    lambdaFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'cloudwatch:namespace': 'UrlShortener/Demo',
        },
      },
    }));

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'URL Shortener HTTP API',
      corsPreflight: {
        allowOrigins: [`https://${DOMAIN_NAME}`],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
        ],
        allowHeaders: ['Content-Type'],
        maxAge: Duration.days(1),
      },
    });

    const integration = new integrations.HttpLambdaIntegration('LambdaIntegration', lambdaFn);

    httpApi.addRoutes({
      path: '/create',
      methods: [apigatewayv2.HttpMethod.POST],
      integration,
    });

    httpApi.addRoutes({
      path: '/s/{shortCode}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });

    httpApi.addRoutes({
      path: '/metrics',
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });

    new apigatewayv2.ApiMapping(this, 'ApiMapping', {
      api: httpApi,
      domainName,
    });

    new EnhancedMonitoring(this, 'EnhancedMonitoring', {
      lambdaFunction: lambdaFn,
      dynamoTable: table,
      apiGateway: httpApi,
      applicationName: 'UrlShortener',
    });

    this.createDashboard(lambdaFn, table);

    this.apiEndpoint = `https://${domainName.name}/`;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      description: 'URL des Shortener-Dienstes',
    });

    new cdk.CfnOutput(this, 'HttpApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API Endpoint for CloudFront',
      exportName: 'UrlShortenerApiEndpointV2',
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/URL-Shortener-Demo`,
      description: 'CloudWatch Dashboard für Demo-Monitoring',
    });

    new cdk.CfnOutput(this, 'EnhancedDashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/URL-Shortener-Demo-Enhanced`,
      description: 'Enhanced CloudWatch Dashboard',
    });
  }

  private createDashboard(fn: LambdaFunction, table: Table): void {
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'URL-Shortener-Demo',
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [fn.metricInvocations()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration',
        left: [fn.metricDuration()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [fn.metricErrors()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read/Write Operations',
        left: [
          table.metricConsumedReadCapacityUnits(),
          table.metricConsumedWriteCapacityUnits(),
        ],
        width: 12,
      }),
    );
  }
}
