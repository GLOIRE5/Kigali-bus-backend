# KigaliTransit Engine – Backend

## quirements
* Node.js 20+
* npm
* Docker Desktop

## Setup

Open PowerShell in the project folder and run:

### 1. Start MongoDB
docker compose up -d

### 2. Install dependencies


npm install

### 3. Create the environment file


copy .env.example .env

### 4. Load the sample data


npm run seed


### 5. Start the backend
npm run dev

The backend will run at:


http://localhost:4000


powershell
Invoke-RestMethod http://localhost:4000/api/health

If the server is working, you should receive a successful health response.

## Quick Start

For future runs, if MongoDB is already set up:

```powershell
docker compose up -d
npm run dev
```

That's it. The backend is now running.
