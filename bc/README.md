# Google Maps Scraper - Minimal REST API

A simplified, production-ready REST API for Google Maps scraping with only 6 essential endpoints.

## ✨ Features

- **Minimal Design**: Only 6 core endpoints (87% reduction from previous version)
- **Simple Authentication**: JWT-based authentication
- **File-based Storage**: No external database required (uses JSON files)
- **Multiple Export Formats**: JSON, CSV, and Excel
- **Clean Code**: 340 lines for the entire API server
- **Lightweight**: Only 9 dependencies

## 🚀 Quick Start

### Installation

```bash
cd bc
npm install
```

### Configuration

Create a `.env` file in the `config/` directory:

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your-super-secret-jwt-key-change-this
CORS_ORIGIN=*
```

### Start Server

```bash
npm start
```

Server will start on `http://localhost:3000`

## 📋 API Endpoints

### Authentication

#### 1. Sign Up
```bash
POST /api/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "yourpassword"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "users_...",
    "email": "user@example.com"
  }
}
```

#### 2. Sign In
```bash
POST /api/auth/signin
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "yourpassword"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "users_...",
    "email": "user@example.com"
  }
}
```

### Core Functionality

#### 3. Start Scraping Job
```bash
POST /api/scrape
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "keywords": [
    "coffee shop in Mumbai",
    "restaurants in Delhi"
  ]
}

Response:
{
  "success": true,
  "jobId": "job_1234567890_abc123",
  "message": "Scraping job started",
  "keywords": ["coffee shop in Mumbai", "restaurants in Delhi"]
}
```

#### 4. Get Job Status
```bash
GET /api/jobs/:jobId
Authorization: Bearer YOUR_JWT_TOKEN

Response:
{
  "jobId": "job_1234567890_abc123",
  "userId": "users_...",
  "keywords": ["coffee shop in Mumbai"],
  "status": "completed",
  "progress": 100,
  "createdAt": "2025-11-18T19:00:00.000Z",
  "completedAt": "2025-11-18T19:05:00.000Z",
  "results": {
    "coffee shop in Mumbai": [
      {
        "name": "Cafe Coffee Day",
        "phone": "+91-22-12345678",
        "address": "123 Main St, Mumbai",
        "rating": "4.5",
        "reviews": "150",
        "website": "https://example.com"
      }
    ]
  }
}
```

#### 5. List All Jobs
```bash
GET /api/jobs?status=completed
Authorization: Bearer YOUR_JWT_TOKEN

Response:
{
  "jobs": [
    {
      "jobId": "job_1234567890_abc123",
      "keywords": ["coffee shop in Mumbai"],
      "status": "completed",
      "progress": 100,
      "createdAt": "2025-11-18T19:00:00.000Z",
      "completedAt": "2025-11-18T19:05:00.000Z"
    }
  ],
  "total": 1
}
```

#### 6. Download Results
```bash
# JSON Format (default)
GET /api/download/:jobId?format=json
Authorization: Bearer YOUR_JWT_TOKEN

# CSV Format
GET /api/download/:jobId?format=csv
Authorization: Bearer YOUR_JWT_TOKEN

# Excel Format
GET /api/download/:jobId?format=excel
Authorization: Bearer YOUR_JWT_TOKEN
```

### Health Check

```bash
GET /api/health

Response:
{
  "status": "ok",
  "timestamp": "2025-11-18T19:30:00.000Z",
  "version": "4.0.0"
}
```

## 📦 Project Structure

```
bc/
├── src/
│   ├── api-server.js          # Main API server (340 lines)
│   ├── scraper-pro.js         # Core scraping logic
│   ├── database/
│   │   ├── db.json            # JSON file storage
│   │   └── json-db.js         # CRUD operations
│   ├── routes/
│   │   └── auth.js            # Authentication routes
│   ├── utils/
│   │   └── export.js          # CSV/Excel export service
│   └── scraper/               # Scraping modules
│       ├── core/
│       ├── browser/
│       └── extractors/
├── config/
│   └── .env                   # Environment configuration
├── package.json
└── README.md
```

## 🔧 Dependencies

```json
{
  "bcryptjs": "^2.4.3",           // Password hashing
  "chalk": "^4.1.2",              // Console colors
  "cors": "^2.8.5",               // CORS middleware
  "dotenv": "^16.0.3",            // Environment variables
  "exceljs": "^4.4.0",            // Excel export
  "express": "^5.1.0",            // Web framework
  "jsonwebtoken": "^9.0.2",       // JWT authentication
  "puppeteer-extra": "^3.3.6",    // Browser automation
  "puppeteer-extra-plugin-stealth": "^2.11.2"  // Anti-detection
}
```

## 📊 Metrics

- **Endpoints**: 7 (6 core + 1 health)
- **Total Lines**: ~665 (api-server + auth + export + db)
- **Dependencies**: 9 packages
- **Storage**: Simple JSON files (no database)

## 🔐 Security

- JWT-based authentication
- Bcrypt password hashing
- CORS support
- Environment-based configuration

## 📝 Notes

- The scraping functionality requires Chrome/Chromium to be installed
- Results are stored in JSON format in `src/database/db.json`
- All endpoints (except `/api/auth/*` and `/api/health`) require JWT authentication

## 🚧 Removed from Previous Version

This minimal version removes:
- MongoDB/Mongoose
- Socket.IO (WebSocket support)
- Redis caching
- Winston logging
- Complex queue management
- Advanced analytics
- Webhook support
- Scheduling features
- 48+ auxiliary endpoints

The core scraping functionality remains unchanged and fully functional.

## 📄 License

ISC
