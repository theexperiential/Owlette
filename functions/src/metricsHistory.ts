/**
 * Metrics History Cloud Function
 *
 * Triggered on every metrics write to populate the metrics_history subcollection.
 * This approach uses the single metrics write from the agent to populate history,
 * avoiding duplicate writes from the agent.
 *
 * Data flow:
 * 1. Agent writes to: sites/{siteId}/machines/{machineId} (metrics data)
 * 2. This function triggers and writes to: sites/{siteId}/machines/{machineId}/metrics_history/{date}
 *
 * Rate limiting:
 * - Checks last sample timestamp to avoid duplicate samples within 55 seconds
 * - Uses Firestore FieldValue.arrayUnion for atomic append (no read-modify-write)
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

// Get Firestore instance
const db = admin.firestore();

/**
 * Historical metrics sample with abbreviated keys for storage efficiency
 */
interface MetricsSample {
  t: number;   // timestamp (unix seconds)
  c: number;   // cpu percent
  m: number;   // memory percent
  d: number;   // disk percent
  g?: number;  // gpu percent (optional)
  ct?: number; // cpu temperature (optional)
  gt?: number; // gpu temperature (optional)
}

/**
 * Triggered when a machine document is written (created or updated).
 * Extracts metrics and appends to the daily history bucket.
 */
export const onMetricsWrite = onDocumentWritten(
  'sites/{siteId}/machines/{machineId}',
  async (event) => {
    const { siteId, machineId } = event.params;

    // Get the after data (new state)
    const afterData = event.data?.after?.data();
    if (!afterData) {
      console.log(`No data after write for ${machineId}, skipping`);
      return;
    }

    // Check if this write contains metrics
    const metrics = afterData.metrics;
    if (!metrics) {
      console.log(`No metrics in write for ${machineId}, skipping`);
      return;
    }

    // Get current timestamp
    const now = Math.floor(Date.now() / 1000);

    // Get today's date in UTC for bucket ID
    const today = new Date();
    const bucketId = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // Path to history document
    const historyRef = db
      .collection('sites')
      .doc(siteId)
      .collection('machines')
      .doc(machineId)
      .collection('metrics_history')
      .doc(bucketId);

    // Check if we should rate limit (avoid duplicate samples within 55 seconds)
    try {
      const historyDoc = await historyRef.get();
      if (historyDoc.exists) {
        const meta = historyDoc.data()?.meta;
        if (meta?.lastSampleTime) {
          const lastSampleTime = meta.lastSampleTime;
          if (now - lastSampleTime < 55) {
            // Too soon since last sample, skip
            console.log(`Rate limiting: last sample was ${now - lastSampleTime}s ago for ${machineId}`);
            return;
          }
        }
      }
    } catch (err) {
      // If we can't check, proceed anyway
      console.warn(`Could not check rate limit for ${machineId}:`, err);
    }

    // Build compact sample object
    const sample: MetricsSample = {
      t: now,
      c: round(metrics.cpu?.percent ?? 0),
      m: round(metrics.memory?.percent ?? 0),
      d: round(metrics.disk?.percent ?? 0),
    };

    // Add optional GPU percent
    if (metrics.gpu?.usage_percent !== undefined && metrics.gpu.usage_percent !== null) {
      sample.g = round(metrics.gpu.usage_percent);
    }

    // Add optional temperatures
    if (metrics.cpu?.temperature !== undefined && metrics.cpu.temperature !== null) {
      sample.ct = round(metrics.cpu.temperature);
    }
    if (metrics.gpu?.temperature !== undefined && metrics.gpu.temperature !== null) {
      sample.gt = round(metrics.gpu.temperature);
    }

    // Use arrayUnion for atomic append without read-modify-write
    try {
      await historyRef.set(
        {
          samples: FieldValue.arrayUnion(sample),
          meta: {
            lastSampleTime: now,
            updatedAt: FieldValue.serverTimestamp(),
            resolution: '1min',
          },
        },
        { merge: true }
      );

      console.log(`Historical sample recorded for ${machineId} in bucket ${bucketId}`);
    } catch (err) {
      console.error(`Failed to write historical sample for ${machineId}:`, err);
      throw err; // Re-throw to mark function as failed
    }
  }
);

/**
 * Round a number to 1 decimal place
 */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
