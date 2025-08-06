import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { UrlShortenerStack } from '../lib/stateless';

describe('UrlShortenerStack Tests', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new UrlShortenerStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('prüft essentielle Ressourcen', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 2);
  });

  test('prüft DynamoDB Table Konfiguration', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        {
          AttributeName: 'short_code',
          AttributeType: 'S'
        }
      ],
      KeySchema: [
        {
          AttributeName: 'short_code',
          KeyType: 'HASH'
        }
      ],
      TimeToLiveSpecification: {
        AttributeName: 'expires_at',
        Enabled: true
      }
    });
  });

  test('prüft API Gateway Routen', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routePaths = Object.values(routes).map(route => route.Properties.RouteKey);
    
    expect(routePaths).toContain('POST /create');
    expect(routePaths).toContain('GET /s/{shortCode}');
    expect(routePaths).toContain('GET /metrics');
  });

  test('prüft CORS Konfiguration', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowHeaders: ['Content-Type'],
        AllowMethods: ['GET', 'POST'],
        AllowOrigins: ['https://url-shortener.vibtellect.de'],
        MaxAge: 86400
      }
    });
  });

  test('prüft IAM Rollen und Policies', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
    
    const policies = template.findResources('AWS::IAM::Policy');
    const policyNames = Object.keys(policies);
    
    expect(policyNames.length).toBeGreaterThan(0);
    
    const policy = policies[policyNames[0]];
    expect(policy.Properties.PolicyDocument.Statement).toBeInstanceOf(Array);
    
    const statements = policy.Properties.PolicyDocument.Statement;
    const dynamoStatement = statements.find((s: any) =>
      s.Action && Array.isArray(s.Action) && s.Action.includes('dynamodb:GetItem')
    );
    
    expect(dynamoStatement).toBeDefined();
    expect(dynamoStatement.Effect).toBe('Allow');
    
    const cloudWatchStatement = statements.find((s: any) =>
      s.Action === 'cloudwatch:PutMetricData'
    );
    
    expect(cloudWatchStatement).toBeDefined();
    expect(cloudWatchStatement.Effect).toBe('Allow');
  });

  test('prüft CloudWatch Dashboards', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const dashboardNames = Object.values(dashboards).map(d => d.Properties.DashboardName);
    
    expect(dashboardNames).toContain('URL-Shortener-Demo');
    expect(dashboardNames).toContain('URL-Shortener-Demo-Enhanced');
  });

  test('prüft Outputs', () => {
    template.hasOutput('ApiEndpoint', {
      Description: 'URL des Shortener-Dienstes'
    });
    
    template.hasOutput('HttpApiEndpoint', {
      Description: 'HTTP API Endpoint for CloudFront',
      Export: { Name: 'UrlShortenerApiEndpointV2' }
    });
    
    template.hasOutput('DashboardUrl', {
      Description: 'CloudWatch Dashboard für Demo-Monitoring'
    });
    
    template.hasOutput('EnhancedDashboardUrl', {
      Description: 'Enhanced CloudWatch Dashboard'
    });
  });

  test('prüft Custom Domain Konfiguration', () => {
    const domainNames = template.findResources('AWS::ApiGatewayV2::DomainName');
    const domainNameKeys = Object.keys(domainNames);
    
    expect(domainNameKeys.length).toBe(1);
    
    const domainName = domainNames[domainNameKeys[0]];
    expect(domainName.Properties.DomainName).toBe('url-shortener.vibtellect.de');
    expect(domainName.Properties.DomainNameConfigurations).toBeInstanceOf(Array);
    expect(domainName.Properties.DomainNameConfigurations.length).toBeGreaterThan(0);
    
    const config = domainName.Properties.DomainNameConfigurations[0];
    expect(config.CertificateArn).toMatch(/arn:aws:acm:us-east-1:/);
  });
});
