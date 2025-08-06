import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface EnhancedMonitoringProps {
  lambdaFunction: lambda.Function;
  dynamoTable: dynamodb.Table;
  apiGateway: apigatewayv2.HttpApi;
  applicationName: string;
}

export class EnhancedMonitoring extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly customMetrics: {
    urlsCreated: cloudwatch.Metric;
    urlsAccessed: cloudwatch.Metric;
    uniqueVisitors: cloudwatch.Metric;
  };

  constructor(scope: Construct, id: string, props: EnhancedMonitoringProps) {
    super(scope, id);

    // Custom Metrics Definition
    this.customMetrics = {
      urlsCreated: new cloudwatch.Metric({
        namespace: 'UrlShortener/Demo',
        metricName: 'UrlsCreated',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      urlsAccessed: new cloudwatch.Metric({
        namespace: 'UrlShortener/Demo',
        metricName: 'UrlsAccessed',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      uniqueVisitors: new cloudwatch.Metric({
        namespace: 'UrlShortener/Demo',
        metricName: 'UniqueVisitors',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
    };

    // Extended Dashboard Configuration
    this.dashboard = new cloudwatch.Dashboard(this, 'UrlShortenerDashboard', {
      dashboardName: 'URL-Shortener-Demo-Enhanced',
    });

    // Add widgets to dashboard
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'URL Creation Rate',
        left: [this.customMetrics.urlsCreated],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'URL Access Rate',
        left: [this.customMetrics.urlsAccessed],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [props.lambdaFunction.metricInvocations()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration',
        left: [props.lambdaFunction.metricDuration()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [props.lambdaFunction.metricErrors()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read/Write Operations',
        left: [
          props.dynamoTable.metricConsumedReadCapacityUnits(),
          props.dynamoTable.metricConsumedWriteCapacityUnits(),
        ],
        width: 12,
      }),
    );
  }
}