# RateX API Gateway

RateX is a powerful API Gateway that provides rate limiting, request queuing, and proxy capabilities for your APIs. It supports multiple rate limiting strategies and allows you to manage multiple applications through a single gateway.

## HLD

![HLD](/images/HLD.png)

These rate limiting servers would scale up and down depending upon load and these would communicate with a centralised Redis data store for scalabilty. At the moment the _users_ and _apps_ data strcutures are stored in Redis but in a real scenario they should be stored in an on-disk database for durability and to avoid data loss.

## Setup Instructions

1. Clone the repository

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file with the following variables:

   ```
   PORT=3000
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=your_redis_password
   REDIS_DB=0
   JWT_SECRET=your_jwt_secret
   ```

4. Start Redis server

   ```
   docker run --name ratex-redis -p 6379:6379 -d redis
   ```

5. Start the application:
   ```bash
   npm start
   ```

## API Endpoints

### Authentication (Single layer authentication using JWT)

#### POST /auth/login

- Logs in a user and sets a JWT cookie
- Request body:
  ```json
  {
  	"email": "user@example.com",
  	"password": "password123"
  }
  ```

#### GET /auth/refresh

- Refreshes the JWT token
- Requires valid JWT cookie

#### GET /auth/logout

- Logs out the user and clears the JWT cookie
- Requires valid JWT cookie

### Users (Single layer authentication using JWT)

#### POST /users

- Creates a new user
- Request body:
  ```json
  {
  	"email": "user@example.com",
  	"password": "password123",
  	"organisationName": "My Org"
  }
  ```

#### GET /users

- Returns user information
- Requires valid JWT and API key

#### PUT /users

- Updates user information
- Requires valid JWT and API key
- Request body:
  ```json
  {
  	"organisationName": "Updated Org Name"
  }
  ```

### Applications (Dual layer authentication using JWT and API KEY)

#### POST /apps

- Creates a new application to proxy
- Requires valid JWT and API key
- Request body:
  ```json
  {
  	"name": "My API",
  	"baseUrl": "https://api.example.com",
  	"rateLimit": {
  		"strategy": "fixed_window",
  		"window": 60,
  		"requests": 100
  	}
  }
  ```

#### GET /apps

- Lists all applications for the user
- Requires valid JWT and API key

#### GET /apps/:appId

- Gets application details
- Requires valid JWT and API key

#### PUT /apps/:appId

- Updates application settings
- Requires valid JWT and API key
- Request body:
  ```json
  {
  	"name": "Updated API Name",
  	"baseUrl": "https://new-api.example.com",
  	"rateLimit": {
  		"strategy": "sliding_window",
  		"window": 60,
  		"requests": 200
  	}
  }
  ```

#### DELETE /apps/:appId

- Deletes an application
- Requires valid JWT and API key

#### GET /apps/:appId/stats

- Gets request statistics for an application
- Requires valid JWT and API key

### Proxy

#### ANY /apis/:appId/\*

- Proxies requests to the target API
- Requires valid API key
- Rate limited based on application settings

#### GET /apis/status/:requestId

- Checks the status of a queued request
- Requires valid API key

## Rate Limiting Strategies

Redis transactions (MULTI / EXEC) are used to implement ACID to an extent with optimistic concurrency control using WATCH. A simple queueing mechanism is used to queue requests that are rate limited to execute later.
RateX supports multiple rate limiting strategies:

1. **Fixed Window**

   - Simple window-based rate limiting
   - Resets at fixed intervals
   - Configuration:
     ```json
     {
     	"strategy": "fixed_window",
     	"window": 60, // seconds
     	"requests": 100 // requests per window
     }
     ```

2. **Sliding Window**

   - More accurate rate limiting that considers overlapping windows
   - Configuration:
     ```json
     {
     	"strategy": "sliding_window",
     	"window": 60,
     	"requests": 100
     }
     ```

3. **Token Bucket**

   - Allows for burst traffic while maintaining average rate
   - Configuration:
     ```json
     {
     	"strategy": "token_bucket",
     	"window": 60,
     	"requests": 100,
     	"burst": 50,
     	"refillRate": 2
     }
     ```

4. **Leaky Bucket**

   - Smooths out traffic spikes
   - Configuration:
     ```json
     {
     	"strategy": "leaky_bucket",
     	"window": 60,
     	"requests": 100,
     	"leakRate": 2
     }
     ```

5. **Sliding Log**
   - Most accurate but memory-intensive
   - Configuration:
     ```json
     {
     	"strategy": "sliding_log",
     	"window": 60,
     	"requests": 100
     }
     ```

## Example Usage

### 1. Register a User

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "organisationName": "My Org"
  }'
```

### 2. Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### 3. Create an Application

```bash
curl -X POST http://localhost:3000/apps \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "name": "My API",
    "baseUrl": "https://api.example.com",
    "rateLimit": {
      "strategy": "fixed_window",
      "window": 60,
      "requests": 100
    }
  }'
```

### 4. Make a Proxied Request

```bash
curl -X GET http://localhost:3000/apis/YOUR_APP_ID/endpoint \
```

### 5. Check Request Status

```bash
curl -X GET http://localhost:3000/apis/status/YOUR_REQUEST_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```
