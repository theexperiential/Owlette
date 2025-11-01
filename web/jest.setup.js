// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock Firebase to avoid initialization errors in tests
jest.mock('./lib/firebase', () => ({
  app: null,
  auth: null,
  db: null,
  isConfigured: false,
}))

// Mock environment variables for tests
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-api-key'
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'test.firebaseapp.com'
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project'
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test.appspot.com'
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '123456789'
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'test-app-id'

// Suppress console errors during tests (optional)
// Uncomment if you want cleaner test output
// const originalError = console.error
// beforeAll(() => {
//   console.error = (...args) => {
//     if (
//       typeof args[0] === 'string' &&
//       args[0].includes('Warning: ReactDOM.render')
//     ) {
//       return
//     }
//     originalError.call(console, ...args)
//   }
// })
//
// afterAll(() => {
//   console.error = originalError
// })
