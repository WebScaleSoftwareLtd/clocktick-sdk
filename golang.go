package sdk

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/vmihailenco/msgpack/v5"
)

// Option defines the structure of an option in the SDK.
type Option struct {
	customEndpointId *string
}

// CustomEndpointID is used to set the custom endpoint ID as an option.
func CustomEndpointID(customEndpointId string) Option {
	return Option{customEndpointId: &customEndpointId}
}

type funcOpts struct {
	f any
	a []Option
}

// Server is used to define the structure of a server in the SDK.
type Server struct {
	client            *http.Client
	apiKey            string
	encryptionKey     cipher.AEAD
	publicKey         ed25519.PublicKey
	defaultEndpointId string
	funcMap           map[string]funcOpts
	panicHandler      func(any)
}

func defaultPanicHandler(err any) {
	fmt.Fprintln(os.Stderr, "panic whilst running job:", err)
}

// NewServer is used to create a new server.
func NewServer(
	apiKey string, encryptionKey string, publicKey string,
	defaultEndpointId string,
) *Server {
	// Hash the encryption key with sha256.
	encryptionKeyBytes := []byte(encryptionKey)
	encryptionKeyHash := sha256.Sum256(encryptionKeyBytes)

	// Turn it into a encryptor.
	block, err := aes.NewCipher(encryptionKeyHash[:])
	if err != nil {
		panic(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		panic(err)
	}

	// Decode the public key from hex.
	publicKeyBytes, err := hex.DecodeString(publicKey)
	if err != nil {
		panic(err)
	}

	// Create the server.
	return &Server{
		client:            http.DefaultClient,
		apiKey:            apiKey,
		encryptionKey:     gcm,
		publicKey:         ed25519.PublicKey(publicKeyBytes),
		defaultEndpointId: defaultEndpointId,
		funcMap:           make(map[string]funcOpts),
		panicHandler:      defaultPanicHandler,
	}
}

// SetClient is used to set the HTTP client of the server.
func (s *Server) SetClient(client *http.Client) {
	s.client = client
}

// SetPanicHandler is used to set the panic handler of the server.
func (s *Server) SetPanicHandler(f func(any)) {
	s.panicHandler = f
}

// AddRoute is used to add a route to the server. f MUST be a function that takes in a
// context.Context and any other number of arguments.
func (s *Server) AddRoute(route string, f any, opts ...Option) {
	// Validate the function.
	fv := reflect.ValueOf(f)
	if fv.Kind() != reflect.Func {
		panic("f must be a function")
	}
	if fv.Type().NumIn() < 1 || fv.Type().In(0) != reflect.TypeOf((*context.Context)(nil)).Elem() {
		panic("f must take in a context.Context as the first argument")
	}

	// Add the function to the map.
	s.funcMap[route] = funcOpts{f: f, a: opts}
}

// JobCreationResponse defines the structure of a job creation response in the SDK.
type JobCreationResponse struct {
	JobID string `json:"job_id"`
}

var staticNonce []byte

// Encrypts the data specified.
func (s *Server) encrypt(data []byte) string {
	nonce := staticNonce
	if nonce == nil {
		// Generate a random nonce for the local scope.
		nonce = make([]byte, s.encryptionKey.NonceSize())
		if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
			panic(err)
		}
	}
	var encryptedData []byte
	encryptedData = s.encryptionKey.Seal(encryptedData, nonce, data, nil)
	return base64.StdEncoding.EncodeToString(nonce) + ":" + base64.StdEncoding.EncodeToString(encryptedData)
}

// Decrypts the data specified.
func (s *Server) decrypt(data string) ([]byte, error) {
	parts := strings.SplitN(data, ":", 2)
	if len(parts) != 2 {
		return nil, errors.New("invalid data")
	}
	nonce, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	if len(nonce) != s.encryptionKey.NonceSize() {
		return nil, errors.New("invalid nonce size")
	}
	encryptedData, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	return s.encryptionKey.Open(nil, nonce, encryptedData, nil)
}

// Delta is used to define the structure of a delta in the SDK.
type Delta struct {
	Years   uint `json:"years"`
	Months  uint `json:"months"`
	Days    uint `json:"days"`
	Hours   uint `json:"hours"`
	Minutes uint `json:"minutes"`
	Seconds uint `json:"seconds"`
}

type createJobSkeleton struct {
	StartFrom     any    `json:"start_from"`
	RunEvery      *Delta `json:"run_every"`
	EndpointID    string `json:"endpoint_id"`
	EncryptedData string `json:"encrypted_data"`
	JobType       string `json:"job_type"`
}

// ScheduleJobPropertiesBuilder is used to define a properties builder.
type ScheduleJobPropertiesBuilder interface {
	buildSkeleton() (id string, data createJobSkeleton)
}

// FromNowPropertiesBuilder is used to create a builder for properties.
type FromNowPropertiesBuilder struct {
	d         Delta
	id        string
	recurring bool
}

// Years is used to add years to the delta.
func (p FromNowPropertiesBuilder) Years(years uint) FromNowPropertiesBuilder {
	p.d.Years += years
	return p
}

// Months is used to add months to the delta.
func (p FromNowPropertiesBuilder) Months(months uint) FromNowPropertiesBuilder {
	p.d.Months += months
	return p
}

// Days is used to add days to the delta.
func (p FromNowPropertiesBuilder) Days(days uint) FromNowPropertiesBuilder {
	p.d.Days += days
	return p
}

// Hours is used to add hours to the delta.
func (p FromNowPropertiesBuilder) Hours(hours uint) FromNowPropertiesBuilder {
	p.d.Hours += hours
	return p
}

// Minutes is used to add minutes to the delta.
func (p FromNowPropertiesBuilder) Minutes(minutes uint) FromNowPropertiesBuilder {
	p.d.Minutes += minutes
	return p
}

// Seconds is used to add seconds to the delta.
func (p FromNowPropertiesBuilder) Seconds(seconds uint) FromNowPropertiesBuilder {
	p.d.Seconds += seconds
	return p
}

// CustomID is used to set the custom ID of the job.
func (p FromNowPropertiesBuilder) CustomID(id string) FromNowPropertiesBuilder {
	p.id = id
	return p
}

// Recurring is used to set the job as recurring.
func (p FromNowPropertiesBuilder) Recurring() FromNowPropertiesBuilder {
	p.recurring = true
	return p
}

func (p FromNowPropertiesBuilder) buildSkeleton() (id string, data createJobSkeleton) {
	j, _ := json.Marshal(p.d)
	typeInjected := append([]byte(`{"type":"delta",`), j[1:]...)
	var runEvery *Delta
	if p.recurring {
		runEvery = &p.d
	}
	return p.id, createJobSkeleton{
		StartFrom:     json.RawMessage(typeInjected),
		RunEvery:      runEvery,
		EndpointID:    "",
		EncryptedData: "",
		JobType:       "",
	}
}

// FromNow is used to create a builder for scheduling a job from now.
func FromNow() FromNowPropertiesBuilder {
	return FromNowPropertiesBuilder{}
}

// FromTimePropertiesBuilder is used to create a builder for properties.
type FromTimePropertiesBuilder struct {
	t  time.Time
	id string
	d  *Delta
}

// EveryYears is used to add years to the delta.
func (p FromTimePropertiesBuilder) EveryYears(years uint) FromTimePropertiesBuilder {
	if p.d == nil {
		p.d = &Delta{}
	}
	p.d.Years += years
	return p
}

// EveryMonths is used to add months to the delta.
func (p FromTimePropertiesBuilder) EveryMonths(months uint) FromTimePropertiesBuilder {
	if p.d == nil {
		p.d = &Delta{}
	}
	p.d.Months += months
	return p
}

// EveryDays is used to add days to the delta.
func (p FromTimePropertiesBuilder) EveryDays(days uint) FromTimePropertiesBuilder {
	if p.d == nil {
		p.d = &Delta{}
	}
	p.d.Days += days
	return p
}

// EveryHours is used to add hours to the delta.
func (p FromTimePropertiesBuilder) EveryHours(hours uint) FromTimePropertiesBuilder {
	if p.d == nil {
		p.d = &Delta{}
	}
	p.d.Hours += hours
	return p
}

// EveryMinutes is used to add minutes to the delta.
func (p FromTimePropertiesBuilder) EveryMinutes(minutes uint) FromTimePropertiesBuilder {
	if p.d == nil {
		p.d = &Delta{}
	}
	p.d.Minutes += minutes
	return p
}

// EverySeconds is used to add seconds to the delta.
func (p FromTimePropertiesBuilder) EverySeconds(seconds uint) FromTimePropertiesBuilder {
	if p.d == nil {
		p.d = &Delta{}
	}
	p.d.Seconds += seconds
	return p
}

// CustomID is used to set the custom ID of the job.
func (p FromTimePropertiesBuilder) CustomID(id string) FromTimePropertiesBuilder {
	p.id = id
	return p
}

type startFromDatetime struct {
	Type     string `json:"type"`
	DateTime string `json:"datetime"`
}

func (p FromTimePropertiesBuilder) buildSkeleton() (id string, data createJobSkeleton) {
	// Format the time as a UTC ISO 8601 string.
	formattedTime := p.t.UTC().Format("2006-01-02T15:04:05Z")

	// Return the ID and skeleton.
	return p.id, createJobSkeleton{
		StartFrom: startFromDatetime{
			Type:     "datetime",
			DateTime: formattedTime,
		},
		RunEvery:      p.d,
		EndpointID:    "",
		EncryptedData: "",
		JobType:       "",
	}
}

// APIError is used to define the structure of an API error in the SDK.
type APIError struct {
	Type    string   `json:"type"`
	Reasons []string `json:"reasons"`
}

// Error is used to convert the API error to a string.
func (e APIError) Error() string {
	return e.Type + ": " + strings.Join(e.Reasons, ", ")
}

// RequestError is a generic error returned by the server.
type RequestError struct {
	Status  int           `json:"status"`
	Request *http.Request `json:"request"`
}

// Error is used to convert the request error to a string.
func (e RequestError) Error() string {
	return "request failed with status " + strconv.Itoa(e.Status)
}

func sendRequest(
	ctx context.Context, client *http.Client, apiKey string, reqUrl string, method string,
	body any, respBody any,
) error {
	// Use DefaultClient if client is nil.
	if client == nil {
		client = http.DefaultClient
	}

	// Build the request.
	var bodyR io.Reader
	if body != nil {
		j, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyR = bytes.NewReader(j)
	}
	req, err := http.NewRequestWithContext(ctx, method, reqUrl, bodyR)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	// Send the request.
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Handle 2xx status codes.
		if respBody != nil {
			err = json.NewDecoder(resp.Body).Decode(respBody)
			if err != nil {
				return err
			}
		}
		return nil
	}

	if resp.Header.Get("X-Is-Application-Error") == "true" {
		// This was returned by the application.
		apiError := APIError{}
		err = json.NewDecoder(resp.Body).Decode(&apiError)
		if err != nil {
			return err
		}
		return apiError
	}

	// Return a generic error.
	return RequestError{Status: resp.StatusCode, Request: req}
}

const jobsEndpoint = "https://clocktick.dev/api/v1/jobs"

// ScheduleJob is used to schedule a job in the server.
func (s *Server) ScheduleJob(
	ctx context.Context, route string, props ScheduleJobPropertiesBuilder,
	args ...any,
) (JobCreationResponse, error) {
	// Check if the route exists in the server.
	r, ok := s.funcMap[route]
	if !ok {
		return JobCreationResponse{}, errors.New("route not found")
	}

	// Get the endpoint ID.
	endpointId := s.defaultEndpointId
	for _, opt := range r.a {
		if opt.customEndpointId != nil {
			endpointId = *opt.customEndpointId
		}
	}

	// Get the function.
	f := r.f
	reflectValue := reflect.ValueOf(f)

	// Get the argument count.
	argumentCount := reflectValue.Type().NumIn()
	if argumentCount-1 != len(args) {
		return JobCreationResponse{}, errors.New("argument count mismatch")
	}

	// Marshal the arguments into msgpack.
	b, err := msgpack.Marshal(args)
	if err != nil {
		return JobCreationResponse{}, err
	}

	// Encrypt the data and send it on.
	encryptedData := s.encrypt(b)
	id, body := props.buildSkeleton()
	body.EndpointID = endpointId
	body.EncryptedData = encryptedData
	body.JobType = route
	reqUrl := jobsEndpoint
	if id != "" {
		reqUrl += "/" + url.PathEscape(id)
	}
	respBody := JobCreationResponse{}
	err = sendRequest(
		ctx, s.client, s.apiKey, reqUrl, "POST", body, &respBody,
	)
	return respBody, err
}

// DeleteJob is used to delete a job with the SDK.
func DeleteJob(ctx context.Context, apiKey string, jobId string) error {
	client, ok := ctx.Value("http.Client").(*http.Client)
	if !ok {
		client = http.DefaultClient
	}
	if jobId == "" {
		return errors.New("job ID is required")
	}
	reqUrl := jobsEndpoint + "/" + url.PathEscape(jobId)
	err := sendRequest(ctx, client, apiKey, reqUrl, "DELETE", nil, nil)
	return err
}

type inboundData struct {
	Type          string `json:"type"`
	EncryptedData string `json:"encrypted_data"`
}

func panicCondom(f func()) (val any) {
	defer func() {
		if r := recover(); r != nil {
			val = r
		}
	}()
	f()
	return
}

// ServeHTTP is used to serve the HTTP requests to the server.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Validate the X-Signature-Ed25519 and X-Signature-Timestamp headers.
	tsHeader := r.Header.Get("X-Signature-Timestamp")
	sigHeader := r.Header.Get("X-Signature-Ed25519")
	if tsHeader == "" || sigHeader == "" {
		http.Error(w, "missing headers", http.StatusBadRequest)
		return
	}

	// Decode the signature from hex.
	sig, err := hex.DecodeString(sigHeader)
	if err != nil {
		http.Error(w, "failed to decode signature", http.StatusBadRequest)
		return
	}

	// Read the data.
	b, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusInternalServerError)
	}

	// Verify the signature.
	dataToVerify := make([]byte, len(tsHeader)+len(b))
	copy(dataToVerify, tsHeader)
	copy(dataToVerify[len(tsHeader):], b)
	if !ed25519.Verify(s.publicKey, dataToVerify, sig) {
		http.Error(w, "failed to verify signature", http.StatusUnauthorized)
		return
	}

	// Check if the request is outdated.
	ts, err := strconv.ParseInt(tsHeader, 10, 64)
	if err != nil {
		http.Error(w, "failed to parse timestamp", http.StatusBadRequest)
		return
	}
	if time.Now().Unix()-ts > 5*60 {
		http.Error(w, "request is outdated", http.StatusUnauthorized)
		return
	}

	// Unmarshal the data.
	var data inboundData
	err = json.Unmarshal(b, &data)
	if err != nil {
		http.Error(w, "failed to unmarshal data", http.StatusBadRequest)
		return
	}

	// Find the route.
	route, ok := s.funcMap[data.Type]
	if !ok {
		http.Error(w, "route not found", http.StatusNotFound)
		return
	}

	// Decrypt the data.
	decryptedData, err := s.decrypt(data.EncryptedData)
	if err != nil {
		http.Error(w, "failed to decrypt data", http.StatusInternalServerError)
		return
	}
	var raws []msgpack.RawMessage
	err = msgpack.Unmarshal(decryptedData, &raws)
	if err != nil {
		http.Error(w, "failed to unmarshal encrypted data", http.StatusInternalServerError)
		return
	}

	// Get the function.
	f := route.f
	reflectValue := reflect.ValueOf(f)
	if reflectValue.Type().NumIn()-1 != len(raws) {
		http.Error(w, "argument count mismatch", http.StatusBadRequest)
		return
	}

	// Call the function with the context and the arguments.
	panicedValue := panicCondom(func() {
		args := make([]reflect.Value, len(raws)+1)
		args[0] = reflect.ValueOf(r.Context())
		for i, raw := range raws {
			args[i+1] = reflect.ValueOf(raw)
		}
		reflectValue.Call(args)
	})
	if panicedValue != nil {
		s.panicHandler(panicedValue)
		http.Error(w, "panic", http.StatusInternalServerError)
	}
}

var _ http.Handler = &Server{}
