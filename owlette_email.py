import shared_utils
import logging
import json
import socket
import psutil
import GPUtil
import keyring
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import base64
import platform
import argparse

# Take an input of the app name that was restarted
parser = argparse.ArgumentParser(description='Send email notifications.')
parser.add_argument('--process_name', type=str, help='Name of the process to notify about')

args = parser.parse_args()
process_name = args.process_name

def get_system_info():
    # Get system information
    cpu_info = platform.processor()
    cpu_usage = psutil.cpu_percent()
    memory_info = psutil.virtual_memory()
    disk_info = psutil.disk_usage('/')
    gpus = GPUtil.getGPUs()
    gpu_info = gpus[0] if gpus else "No GPU detected"

    # Convert bytes to gigabytes
    bytes_to_gb = lambda x: round(x / (1024 ** 3), 2)

    return {
        'cpu_model': cpu_info,
        'cpu_usage': cpu_usage,
        'memory_used': bytes_to_gb(memory_info.used),
        'memory_total': bytes_to_gb(memory_info.total),
        'disk_used': bytes_to_gb(disk_info.used),
        'disk_total': bytes_to_gb(disk_info.total),
        'gpu_model': gpu_info.name if gpu_info else 'N/A',
        'gpu_info': gpu_info.memoryUsed if gpu_info else 'N/A',
        'gpu_total': gpu_info.memoryTotal if gpu_info else 'N/A'
    }

def send_email(app_name):
    logging.basicConfig(filename=shared_utils.get_path('_email.log'), level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    # Load config
    with open(shared_utils.get_path('config.json'), 'r') as f:
        config = json.load(f)

    # Get refresh token
    refresh_token = keyring.get_password("Owlette", "GmailRefreshToken")

    with open(shared_utils.get_path('client_secrets.json'), 'r') as f:
        client_info = json.load(f)
        client_id = client_info['installed']['client_id']
        client_secret = client_info['installed']['client_secret']
        token_uri = client_info['installed']['token_uri']

    #logging.info(f'client_id: {client_id}')
    #logging.info(f'client_secret: {client_secret}')
    #logging.info(f'refresh_token: {refresh_token}')

    # Initialize the Gmail API client
    credentials = Credentials.from_authorized_user_info({
        'refresh_token': refresh_token,
        'client_id': client_id,
        'client_secret': client_secret,
        'token_uri': token_uri
    })
    service = build('gmail', 'v1', credentials=credentials)

    # Get system info
    system_info = get_system_info()

    # Email subject and body
    hostname = socket.gethostname()
    subject = f"Owlette on {hostname} - {app_name} restarted"
    body = f"""
        Owlette detected that the app '{app_name}' was restarted on {hostname} at {datetime.now()}.
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
    for to_email in config['email']['to']:
        msg['To'] = to_email
        msg['From'] = config['email']['from']
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        message = {'raw': raw_message}
        message = service.users().messages().send(userId='me', body=message).execute()

        logging.info(f"Sent email from {msg['From']} to {[msg['To']]} about {app_name}")

# for debugging
send_email(process_name)