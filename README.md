# RateX - Rate Limiting Proxy API Service

RateX is a proxy API service that handles rate limiting for third-party APIs. It acts as an intermediary layer between clients and their target APIs, managing rate limits transparently.

## Features

- API Key Management
- Application Registration
- Proxy Functionality
- Rate Limit Handling
- Multiple Rate Limiting Strategies
- Request Analytics
- Request Prioritization

## Prerequisites

- Node.js (v16 or higher)
- Redis (for rate limiting and caching)
- npm or yarn

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/ratex.git
cd ratex
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:

```env
PORT=3000
JWT_SECRET=your_jwt_secret
REDIS_URL=redis://localhost:6379
```

4. Start the development server:

```bash
npm run dev
```

5. Build and start the production server:

```bash
npm run build
npm start
```

## API Endpoints

### Authentication

- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login and get API key
- `POST /auth/refresh` - Refresh API key

### Application Management

- `POST /apps` - Register a new API application
- `GET /apps` - List all registered applications
- `GET /apps/:id` - Get application details
- `PUT /apps/:id` - Update application configuration
- `DELETE /apps/:id` - Delete application

### Proxy Endpoints

- `ANY /apis/:app_id/*` - Proxy requests to registered APIs

## Rate Limiting Strategies

RateX supports multiple rate limiting strategies:

1. **Fixed Window**

   - Simple count of requests within a fixed time window
   - Configuration: requests per window, window size

2. **Sliding Window**

   - More accurate rate limiting using a sliding window
   - Configuration: requests per window, window size

3. **Token Bucket**
   - Allows for burst handling
   - Configuration: bucket size, refill rate

## Example Usage

### Register a New API Application

```bash
curl -X POST http://localhost:3000/apps \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenAI API",
    "baseUrl": "https://api.openai.com",
    "rateLimit": {
      "strategy": "fixed_window",
      "requests": 100,
      "window": 60
    }
  }'
```

### Make a Proxied Request

```bash
curl -X POST http://localhost:3000/apis/YOUR_APP_ID/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## License

MIT
