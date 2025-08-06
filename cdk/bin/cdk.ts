#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { UrlShortenerStack } from '../lib/stateless';
import { CloudFrontStack } from '../lib/cloudfront';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;

// Backend Stack
const urlShortenerStack = new UrlShortenerStack(app, 'UrlShortenerStack', {
  env: { account, region: 'us-east-1' }
});

// CloudFront Stack
new CloudFrontStack(app, 'CloudFrontStack', {
  env: { account, region: 'us-east-1' },
  certArn: 'arn:aws:acm:us-east-1:440744214189:certificate/db6b1dd5-9cf5-48dd-bee1-e65036700312',
  domainName: 'url-shortener.vibtellect.de'
});