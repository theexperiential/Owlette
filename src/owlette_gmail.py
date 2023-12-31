import shared_utils
import logging
import json
import keyring
from datetime import datetime
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import base64
import argparse

# Take an input of the app name that was restarted
parser = argparse.ArgumentParser(description='Send email notifications.')
parser.add_argument('--process_name', type=str, help='Name of the process to notify about')
parser.add_argument('--reason', type=str, help='Reason for the email notification')
args = parser.parse_args()
process_name = args.process_name
reason = args.reason

def send_email(app_name, reason):
    # Load config
    with open(shared_utils.get_path('../config/config.json'), 'r') as f:
        config = json.load(f)

    # Get refresh token
    refresh_token = keyring.get_password("Owlette", "GmailRefreshToken")

    with open(shared_utils.get_path('../config/client_secrets.json'), 'r') as f:
        client_info = json.load(f)
        client_id = client_info['installed']['client_id']
        client_secret = client_info['installed']['client_secret']
        token_uri = client_info['installed']['token_uri']

    # Initialize the Gmail API client
    credentials = Credentials.from_authorized_user_info({
        'refresh_token': refresh_token,
        'client_id': client_id,
        'client_secret': client_secret,
        'token_uri': token_uri
    })
    service = build('gmail', 'v1', credentials=credentials)

    # Get system info
    system_info = shared_utils.get_system_info()

    # Email subject and body
    hostname = shared_utils.get_hostname()
    # Modify the email subject and body based on the reason
    if reason == "restarted":
        subject = f"Owlette on {hostname} - {app_name} restarted"
        body_intro = f"Owlette detected that the app '{app_name}' was restarted on {hostname} at {datetime.now()}."
    elif reason == "frozen":
        subject = f"Owlette on {hostname} - {app_name} is frozen"
        body_intro = f"Owlette detected that the app '{app_name}' is frozen on {hostname} at {datetime.now()}."
    else:
        subject = f"Owlette on {hostname} - {app_name} status update"
        body_intro = f"Owlette detected a status update for the app '{app_name}' on {hostname} at {datetime.now()}. \nDetails: {reason}"

    body = f"""
        {body_intro}
        System Info:
        - CPU Model: {system_info['cpu_model']}
        - CPU Usage: {system_info['cpu_usage']}%
        - Memory Used/Total: {system_info['memory_used']} GB/{system_info['memory_total']} GB
        - Disk Used/Total: {system_info['disk_used']} GB/{system_info['disk_total']} GB
        - GPU Model: {system_info['gpu_model']}
        - GPU VRAM Used/Total: {system_info['gpu_info']} MB/{system_info['gpu_total']} MB
        """

    # Create the email message
    msg = MIMEMultipart()
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    # Loop through each email in the 'to' list
    for to_email in config['gmail']['to']:
        msg['To'] = to_email
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        message = {'raw': raw_message}
        message = service.users().messages().send(userId='me', body=message).execute()

        logging.info(f"Sent email to {[msg['To']]} about {app_name}")

    # confirmation print for initial email config
    if app_name == 'Owlette Mail Service':
        print('Sent successfully')

try:
    send_email(process_name, reason)
except Exception as e:
    logging.error(e)