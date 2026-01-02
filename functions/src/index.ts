/**
 * Owlette Cloud Functions
 *
 * Functions for metrics history aggregation and data management.
 */

import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
admin.initializeApp();

// Export all functions
export { onMetricsWrite } from './metricsHistory';
