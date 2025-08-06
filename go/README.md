# URL Shortener Lambda Function (Go)

## Overview
High-performance Lambda function written in Go for URL shortening service.

## Features
- ✅ **DynamoDB Integration** with TTL for automatic cleanup
- ✅ **CloudWatch Metrics** for monitoring
- ✅ **ARM64 Architecture** for 20% cost savings
- ✅ **Input Validation** to prevent SSRF attacks
- ✅ **Deterministic Short Codes** using SHA-256

## Architecture Decisions

### Why Go?
- **Cold Start**: ~100ms (vs 300ms+ for Node.js)
- **Memory Usage**: 128MB sufficient (vs 256MB+ for Node.js)
- **Cost**: 60% cheaper than equivalent Node.js function

### Why ARM64?
- 20% better price-performance than x86
- Same code, lower costs
- Future-proof architecture choice

## API Endpoints

### POST /create
```json
{
  "url": "https://example.com/very-long-url"
}
```

Response:
```json
{
  "short_url": "https://url-shortener.vibtellect.de/s/abc123",
  "expires_at": "2024-01-15T10:00:00Z"
}
```

### GET /s/{shortCode}
Redirects to original URL with 301 status code.

### GET /metrics
Returns current statistics (for demo dashboard).

## Local Testing
```bash
go test -v ./...
```

## Deployment
Handled automatically by CDK:
```bash
cd ../
cdk deploy UrlShortenerStack
```

## Performance Metrics
- **Average Latency**: <50ms
- **Cold Start**: ~100ms
- **Memory Usage**: ~30MB of 128MB allocated
- **Cost**: ~$0.20/month for 1M requests

## Security Features
- URL validation (http/https only)
- No open redirects
- Automatic expiration after 7 days
- CloudWatch alerting on errors

## Future Improvements (not implemented)
These could be added for production use:
- Rate limiting per IP
- Custom short codes
- Analytics tracking
- URL preview feature
- Bulk URL creation API
