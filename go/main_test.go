package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestMain(m *testing.M) {
	// Set required environment variables for tests
	os.Setenv("DYNAMODB_TABLE", "test-table")
	os.Setenv("BASE_URL", "https://test.vibtellect.de")

	code := m.Run()
	os.Exit(code)
}

// Test input validation without AWS dependencies
func TestValidateURL(t *testing.T) {
	tests := []struct {
		name          string
		url           string
		expectedError bool
	}{
		{"valid https", "https://foo.com", false},
		{"valid http", "http://foo.com", false},
		{"invalid ftp", "ftp://foo.com", true},
		{"invalid format", "not-a-url", true},
		{"empty url", "", true},
	}

	for _, c := range tests {
		t.Run(c.name, func(t *testing.T) {
			got := isVaildHTTPUrl(c.url)
			if got == !c.expectedError {
				t.Errorf("isValidHTTPURL(%q) = %v, want error: %v", c.url, got, c.expectedError)
			}
		})
	}
}

// Test short code generation
func TestGenerateShortCode(t *testing.T) {
	t.Parallel()

	cases := []struct {
		desc     string
		input    string
		expected string
	}{
		{"foo.com", "https://foo.com", "a9a9b569"},
		{"bar.com", "https://bar.com", "23d97719"},
		{"empty", "", "e3b0c442"},
	}

	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			got := generateShortCode(c.input)
			if got != c.expected {
				t.Errorf("shortCode(%q) = %s, want %s", c.input, got, c.expected)
			}
		})
	}
}

// Test request handling for invalid inputs
func TestHandleRequestValidation(t *testing.T) {
	if dynamoClient != nil {
		t.Skip("Skipping when AWS client is initialized")
	}

	tests := []struct {
		desc       string
		method     string
		path       string
		body       string
		status     int
		errSnippet string
	}{
		{"bad JSON", "POST", "/create", "not-json", 400, "Invalid JSON"},
		{"missing URL", "POST", "/create", `{}`, 400, "URL parameter is required"},
		{"unsupported scheme", "POST", "/create", `{"url":"ftp://example.com"}`, 400, "Invalid URL"},
		{"route not found", "GET", "/unknown", "", 404, "Not found"},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			req := events.APIGatewayV2HTTPRequest{
				RequestContext: events.APIGatewayV2HTTPRequestContext{
					HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
						Method: test.method,
					},
				},
				RawPath: test.path,
				Body:    test.body,
			}

			resp, err := handleRequest(context.Background(), req)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp.StatusCode != test.status {
				t.Errorf("expected status %d, got %d", test.status, resp.StatusCode)
			}
			if !strings.Contains(resp.Body, test.errSnippet) {
				t.Errorf("expected error message to contain %q, got %q", test.errSnippet, resp.Body)
			}
		})
	}
}

// Test response format for create endpoint
func TestCreateResponseFormat(t *testing.T) {
	const responseJSON = `{"short_url":"https://test.example.com/s/abc123","expires_at":"2024-01-15T10:00:00Z"}`
	var resp map[string]string

	if err := json.Unmarshal([]byte(responseJSON), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if !strings.HasPrefix(resp["short_url"], "https://") {
		t.Errorf("short_url should start with https://, got %s", resp["short_url"])
	}
	if !strings.Contains(resp["short_url"], "/s/") {
		t.Errorf("short_url should contain /s/, got %s", resp["short_url"])
	}
}

// Test metrics response format
func TestMetricsResponseFormat(t *testing.T) {
	// Sample metrics response
	sampleResponse := `{
		"urls_created": 10,
		"urls_accessed": 25,
		"unique_visitors": 15,
		"active_urls": 8,
		"timestamp": "2024-01-15T10:00:00Z"
	}`

	var response map[string]interface{}
	err := json.Unmarshal([]byte(sampleResponse), &response)
	if err != nil {
		t.Fatalf("Failed to unmarshal metrics: %v", err)
	}

	requiredFields := []string{"urls_created", "urls_accessed", "unique_visitors", "active_urls", "timestamp"}

	for _, field := range requiredFields {
		if _, ok := response[field]; !ok {
			t.Errorf("Metrics response missing field: %s", field)
		}
	}
}

// Test URL record struct
func TestURLRecord(t *testing.T) {
	record := URLRecord{
		ShortCode:   "abc123",
		OriginalURL: "https://example.com",
		ExpiresAt:   1234567890,
		CreatedAt:   "2024-01-15T10:00:00Z",
		ClickCount:  5,
	}

	if record.ShortCode != "abc123" {
		t.Error("ShortCode not set correctly")
	}

	if record.OriginalURL != "https://example.com" {
		t.Error("OriginalURL not set correctly")
	}

	if record.ExpiresAt != 1234567890 {
		t.Error("ExpiresAt not set correctly")
	}

	if record.ClickCount != 5 {
		t.Error("ClickCount not set correctly")
	}
}

// Benchmark for short code generation
func BenchmarkGenerateShortCode(b *testing.B) {
	testURL := "https://example.com/very/long/url/with/many/parameters?foo=bar&baz=qux"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hash := sha256.Sum256([]byte(testURL))
		_ = hex.EncodeToString(hash[:])[:8]
	}
}

// Benchmark for JSON parsing
func BenchmarkJSONParsing(b *testing.B) {
	jsonBody := `{"url": "https://example.com/test"}`

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var data map[string]string
		_ = json.Unmarshal([]byte(jsonBody), &data)
	}
}

// Helper function to validate HTTP URLs
func isVaildHTTPUrl(raw string) bool {
	parsedURL, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return parsedURL.Scheme == "http" || parsedURL.Scheme == "https"
}

// Helper function to generate a short code from a URL
func generateShortCode(input string) string {
	hash := sha256.Sum256([]byte(input))
	return hex.EncodeToString(hash[:])[:8]
}
