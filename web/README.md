# Owlette Web Portal

Next.js 16 web portal for managing Windows processes via Owlette agents.

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

3. Add your Firebase credentials to `.env.local`:

**Client-Side Config** (Firebase Console → Project Settings → General → Your apps → Web app):
```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

**Server-Side Admin SDK** (Firebase Console → Project Settings → Service Accounts → Generate new private key):
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBA...(full key here)...\n-----END PRIVATE KEY-----"
```

> **Note:** The Admin SDK credentials are required for OAuth agent authentication (custom token generation).

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Deployment to Railway

1. Push to GitHub
2. Connect repository to Railway
3. Point to `/web` directory in settings
4. Add **ALL** environment variables from above (both client-side and server-side)
   - All `NEXT_PUBLIC_*` variables (client-side Firebase config)
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (server-side Admin SDK)
5. Deploy!

> **Important:** The server-side Admin SDK variables are required for agent OAuth authentication. Without them, agents cannot authenticate during installation.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **React:** React 19
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Authentication:** Firebase Auth
- **Database:** Cloud Firestore
- **Deployment:** Railway
