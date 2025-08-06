package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamodbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type URLRecord struct {
	ShortCode   string `dynamodbav:"short_code"`
	OriginalURL string `dynamodbav:"original_url"`
	ExpiresAt   int64  `dynamodbav:"expires_at"`
	CreatedAt   string `dynamodbav:"created_at"`
	ClickCount  int64  `dynamodbav:"click_count,omitempty"`
}

var (
	dynamoClient     *dynamodb.Client
	cloudwatchClient *cloudwatch.Client
	tableName        string
	baseURL          string
)

func init() {
	// Skip AWS initialization in test mode
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") == "" && os.Getenv("TEST_MODE") == "" {
		// Running locally or in tests, don't initialize AWS clients
		tableName = os.Getenv("DYNAMODB_TABLE")
		if tableName == "" {
			tableName = "test-table" // Default for tests
		}
		baseURL = os.Getenv("BASE_URL")
		if baseURL == "" {
			baseURL = "https://url-shortener.vibtellect.de"
		}
		return
	}

	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	dynamoClient = dynamodb.NewFromConfig(cfg)
	cloudwatchClient = cloudwatch.NewFromConfig(cfg)
	tableName = os.Getenv("DYNAMODB_TABLE")
	baseURL = os.Getenv("BASE_URL")

	if tableName == "" {
		log.Fatal("DYNAMODB_TABLE environment variable is required")
	}
	if baseURL == "" {
		baseURL = "https://url-shortener.vibtellect.de"
	}
}

func handleRequest(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// Einfache Header - CORS wird vom API Gateway gehandhabt
	headers := map[string]string{
		"Content-Type": "application/json",
	}

	// Handle POST /create
	if request.RequestContext.HTTP.Method == "POST" && request.RawPath == "/create" {
		return handleCreate(ctx, request, headers)
	}

	// Handle GET /s/{shortCode} - konsistent mit API Gateway Route
	if request.RequestContext.HTTP.Method == "GET" && request.PathParameters["shortCode"] != "" {
		return handleRedirect(ctx, request, headers)
	}

	// Handle GET /metrics
	if request.RequestContext.HTTP.Method == "GET" && request.RawPath == "/metrics" {
		return handleMetrics(ctx, request, headers)
	}

	return events.APIGatewayV2HTTPResponse{
		StatusCode: 404,
		Headers:    headers,
		Body:       `{"error": "Not found"}`,
	}, nil
}

func handleCreate(ctx context.Context, request events.APIGatewayV2HTTPRequest, headers map[string]string) (events.APIGatewayV2HTTPResponse, error) {
	// Parse JSON request body - vereinfacht, da Frontend nur JSON sendet
	var requestData map[string]string
	if err := json.Unmarshal([]byte(request.Body), &requestData); err != nil {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 400,
			Headers:    headers,
			Body:       `{"error": "Invalid JSON in request body"}`,
		}, nil
	}

	rawURL := requestData["url"]
	if rawURL == "" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 400,
			Headers:    headers,
			Body:       `{"error": "URL parameter is required"}`,
		}, nil
	}

	// Validate URL
	parsedURL, err := url.Parse(rawURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 400,
			Headers:    headers,
			Body:       `{"error": "Invalid URL: only http and https allowed"}`,
		}, nil
	}

	// Generate short code
	hash := sha256.Sum256([]byte(rawURL))
	shortCode := hex.EncodeToString(hash[:])[:8]

	// Create URL record with TTL (expires in 1 week)
	expiresAt := time.Now().Add(7 * 24 * time.Hour).Unix()
	record := URLRecord{
		ShortCode:   shortCode,
		OriginalURL: rawURL,
		ExpiresAt:   expiresAt,
		CreatedAt:   time.Now().Format(time.RFC3339),
		ClickCount:  0,
	}

	// Convert to DynamoDB item
	item, err := attributevalue.MarshalMap(record)
	if err != nil {
		log.Printf("Failed to marshal record: %v", err)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 500,
			Headers:    headers,
			Body:       `{"error": "Internal server error"}`,
		}, nil
	}

	// Put item in DynamoDB
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	if err != nil {
		log.Printf("Failed to put item in DynamoDB: %v", err)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 500,
			Headers:    headers,
			Body:       `{"error": "Internal server error"}`,
		}, nil
	}

	// Return response - konsistent mit CloudFront /s/* Route
	response := map[string]string{
		"short_url":  fmt.Sprintf("%s/s/%s", baseURL, shortCode),
		"expires_at": time.Unix(expiresAt, 0).Format(time.RFC3339),
	}

	responseBody, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: 200,
		Headers:    headers,
		Body:       string(responseBody),
	}, nil
}

func handleRedirect(ctx context.Context, request events.APIGatewayV2HTTPRequest, headers map[string]string) (events.APIGatewayV2HTTPResponse, error) {
	shortCode := request.PathParameters["shortCode"]

	// Get item from DynamoDB
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]dynamodbtypes.AttributeValue{
			"short_code": &dynamodbtypes.AttributeValueMemberS{Value: shortCode},
		},
	})
	if err != nil {
		log.Printf("Failed to get item from DynamoDB: %v", err)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 500,
			Headers:    headers,
			Body:       `{"error": "Internal server error"}`,
		}, nil
	}

	if result.Item == nil {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 404,
			Headers:    headers,
			Body:       `{"error": "Short URL not found"}`,
		}, nil
	}

	// Unmarshal the record
	var record URLRecord
	err = attributevalue.UnmarshalMap(result.Item, &record)
	if err != nil {
		log.Printf("Failed to unmarshal record: %v", err)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 500,
			Headers:    headers,
			Body:       `{"error": "Internal server error"}`,
		}, nil
	}

	// Check if URL has expired (additional check, DynamoDB TTL should handle this)
	if time.Now().Unix() > record.ExpiresAt {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 404,
			Headers:    headers,
			Body:       `{"error": "Short URL has expired"}`,
		}, nil
	}

	// Increment click count and update record
	record.ClickCount++
	updatedItem, err := attributevalue.MarshalMap(record)
	if err != nil {
		log.Printf("Failed to marshal updated record: %v", err)
	} else {
		// Update item in DynamoDB with new click count
		_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(tableName),
			Item:      updatedItem,
		})
		if err != nil {
			log.Printf("Failed to update click count: %v", err)
		}
	}

	// Publish click metric
	go func() {
		ctx := context.Background()
		publishCustomMetric(ctx, "UrlsAccessed", 1)
	}()

	// Redirect to original URL
	redirectHeaders := make(map[string]string)
	for k, v := range headers {
		redirectHeaders[k] = v
	}
	redirectHeaders["Location"] = record.OriginalURL

	return events.APIGatewayV2HTTPResponse{
		StatusCode: 301,
		Headers:    redirectHeaders,
	}, nil
}

func publishCustomMetric(ctx context.Context, metricName string, value float64) error {
	if cloudwatchClient == nil {
		return fmt.Errorf("cloudwatch client not initialized")
	}

	_, err := cloudwatchClient.PutMetricData(ctx, &cloudwatch.PutMetricDataInput{
		Namespace: aws.String("UrlShortener/Demo"),
		MetricData: []types.MetricDatum{
			{
				MetricName: aws.String(metricName),
				Value:      aws.Float64(value),
				Unit:       types.StandardUnitCount,
				Timestamp:  aws.Time(time.Now()),
			},
		},
	})

	return err
}

func handleMetrics(ctx context.Context, request events.APIGatewayV2HTTPRequest, headers map[string]string) (events.APIGatewayV2HTTPResponse, error) {
	// Publish a metric for metrics access
	go func() {
		ctx := context.Background()
		publishCustomMetric(ctx, "MetricsAccessed", 1)
	}()

	// Get actual counts from DynamoDB
	var urlsCreated int64
	var urlsAccessed int64
	var activeUrls int64

	// Scan the table to get actual metrics
	scanResult, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		log.Printf("Failed to scan DynamoDB: %v", err)
		// Return mock data if scan fails
		response := map[string]interface{}{
			"urls_created":    0,
			"urls_accessed":   0,
			"unique_visitors": 0,
			"active_urls":     0,
			"timestamp":       time.Now().Format(time.RFC3339),
			"error":           "Failed to fetch metrics",
		}
		responseBody, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 200,
			Headers:    headers,
			Body:       string(responseBody),
		}, nil
	}

	// Process scan results
	activeUrls = int64(len(scanResult.Items))
	for _, item := range scanResult.Items {
		var record URLRecord
		err := attributevalue.UnmarshalMap(item, &record)
		if err == nil {
			urlsCreated++
			urlsAccessed += record.ClickCount
		}
	}

	response := map[string]interface{}{
		"urls_created":    urlsCreated,
		"urls_accessed":   urlsAccessed,
		"unique_visitors": urlsAccessed, // Simple approximation
		"active_urls":     activeUrls,
		"timestamp":       time.Now().Format(time.RFC3339),
	}

	responseBody, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: 200,
		Headers:    headers,
		Body:       string(responseBody),
	}, nil
}

func main() {
	lambda.Start(handleRequest)
}
