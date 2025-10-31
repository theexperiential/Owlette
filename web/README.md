# Owlette Web Portal

Next.js 14 web portal for managing Windows processes via Owlette agents.

## Features

- 🔐 Firebase Authentication (Email + Google OAuth)
- 📊 Real-time dashboard with live metrics
- 🖥️ Machine management and monitoring
- ⚙️ Process configuration from the web
- 🔄 Bidirectional sync with Owlette agents

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore enabled
- Firebase Authentication enabled (Email/Password + Google)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

3. Add your Firebase credentials to `.env.local` (get from Firebase Console > Project Settings > Web App)

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Deployment to Railway

1. Push to GitHub
2. Connect repository to Railway
3. Point to `/web` directory in settings
4. Add environment variables (Firebase config)
5. Deploy!

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Authentication:** Firebase Auth
- **Database:** Cloud Firestore
- **Deployment:** Railway
