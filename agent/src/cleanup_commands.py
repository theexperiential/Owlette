#!/usr/bin/env python3
"""
Quick script to clean up old pending commands from Firestore
"""

import firebase_admin
from firebase_admin import credentials, firestore
import json
import socket

# Load config
with open('../config/config.json', 'r') as f:
    config = json.load(f)

# Initialize Firebase
cred = credentials.Certificate('../config/firebase-credentials.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

site_id = config['firebase']['site_id']
machine_id = socket.gethostname()  # Get machine ID from hostname

print(f"Cleaning up commands for site: {site_id}, machine: {machine_id}")

# Clear pending commands by deleting and recreating the document
pending_ref = db.collection('sites').document(site_id)\
    .collection('machines').document(machine_id)\
    .collection('commands').document('pending')

pending_doc = pending_ref.get()
if pending_doc.exists:
    data = pending_doc.to_dict()
    if data:
        print(f"Found {len(data)} pending commands")
        # Delete the entire document
        pending_ref.delete()
        print("✓ Deleted pending commands document")
        # Recreate as empty
        pending_ref.set({})
        print("✓ Created fresh empty pending commands document")
    else:
        print("No pending commands found")
else:
    print("Pending document doesn't exist")

print("\nDone! You can now create a fresh deployment.")
