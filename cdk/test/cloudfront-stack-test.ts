import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CloudFrontStack } from '../lib/cloudfront';

test('CloudFrontStack - prüft Distribution & S3', () => {
  const app = new App();

  const stack = new CloudFrontStack(app, 'TestCFStack', {
    certArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc',
    domainName: 'test.vibtellect.de',
  });

  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.resourceCountIs('AWS::Route53::RecordSet', 1);
});
