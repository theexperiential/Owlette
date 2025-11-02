import keyring
import logging
import requests
import shared_utils
import argparse

# Load logging
shared_utils.initialize_logging("slack")

# Take an input of the app name that was restarted
parser = argparse.ArgumentParser(description='Send Slack notifications.')
parser.add_argument('--process_name', type=str, help='Name of the process to notify about')
parser.add_argument('--reason', type=str, help='Reason for the Slack notification')
args = parser.parse_args()
process_name = args.process_name
reason = args.reason

def get_cred(name, item):
    cred = keyring.get_password(name, item)
    if cred is None:
        logging.error("Windows credential not found")
        return None
    else:
        return cred

def slack_api_call(method, url, token, params=None, json=None):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.request(method, url, headers=headers, params=params, json=json)
    
    if response.status_code == 200:
        response_json = response.json()
        if response_json.get('ok'):
            return response_json
        else:
            logging.error(f"Slack API Error: {response_json.get('error')}")
            return None
    else:
        logging.error(f"HTTP Error: {response.status_code}")
        return None

def get_workspace_owner_id(token):
    url = "https://slack.com/api/users.list"
    response_json = slack_api_call("GET", url, token)
    
    if response_json:
        for user in response_json.get('members', []):
            if user.get('is_owner'):
                return user.get('id')
    return None

def invite_user_to_channel(token, channel_id, user_id):
    url = "https://slack.com/api/conversations.invite"
    data = {"channel": channel_id, "users": user_id}
    response_json = slack_api_call("POST", url, token, json=data)
    
    if response_json:
        logging.info(f"Successfully invited user {user_id} to channel {channel_id}")
    else:
        logging.error(f"Failed to invite user to channel")

def get_channel_id_by_name(token, channel_name):
    url = "https://slack.com/api/conversations.list"
    params = {"limit": 1000}  # Adjust as needed
    response_json = slack_api_call("GET", url, token, params=params)
    
    if response_json:
        for channel in response_json.get('channels', []):
            if channel.get('name') == channel_name:
                return channel.get('id')
    return None

def create_channel(token, channel_name):
    url = "https://slack.com/api/conversations.create"
    data = {"name": channel_name, "is_private": False}  # Set to True for a private channel
    response_json = slack_api_call("POST", url, token, json=data)
    
    if response_json:
        channel_id = response_json['channel']['id']
        logging.info(f"Successfully created channel {channel_id}")

        # Invite the workspace owner to this channel
        owner_id = get_workspace_owner_id(token)
        if owner_id:
            invite_user_to_channel(token, channel_id, owner_id)
        
        # Save Channel ID to Windows Credentials for future use
        keyring.set_password("Owlette", "ChannelID", channel_id)
        logging.info(f"Added Channel ID {channel_id} to Windows Credentials")
        
        return channel_id
    else:
        logging.info("Failed to create channel, checking if the name is already taken.")
        channel_id = get_channel_id_by_name(token, channel_name)
        
        if channel_id:
            # Save Channel ID to Windows Credentials for future use
            keyring.set_password("Owlette", "ChannelID", channel_id)
            logging.info(f"Added existing Channel ID {channel_id} to Windows Credentials")
            return channel_id
        else:
            logging.error("Failed to fetch or create the channel.")
            return None

def send_message(message_text):
    token = get_cred('Owlette', 'SlackBotUserOAuthToken')
    channel_id = get_cred('Owlette', 'ChannelID')
    if token and channel_id:
        url = "https://slack.com/api/chat.postMessage"

        # Get system info
        system_info = shared_utils.get_system_info()

        # Create the alert block
        alert_block = {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f":owl: :loudspeaker: *Hoo!* @channel\n\n> {message_text}"
            }
        }

        # Create the metrics block
        metrics_block = {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f":mag: *System Metrics*\n\n> - :computer: CPU Model: *{system_info['cpu_model']}*\n> - :zap: CPU Usage: *{system_info['cpu_usage']}%*\n> - :thermometer: Memory Used/Total: *{system_info['memory_used']} GB*/{system_info['memory_total']} GB\n> - :cd: Disk Used/Total: *{system_info['disk_used']} GB*/{system_info['disk_total']} GB\n> - :video_game: GPU Model: *{system_info['gpu_model']}*\n> - :film_frames: GPU VRAM Used/Total: *{system_info['gpu_info']} MB*/{system_info['gpu_total']} MB"
            }
        }


        # Create the message payload
        data = {
            "channel": channel_id,
            "blocks": [alert_block, metrics_block],
            "attachments": [
                {
                    "color": "#36a64f",  # You can change the color
                }
            ]
        }

        # Send the message
        response_json = slack_api_call("POST", url, token, json=data)
        
        if response_json:
            logging.info(f"Successfully sent message {message_text}. Response: {response_json}")
        else:
            logging.error(f"Failed to send message. Response: {response_json}")
        
        return channel_id

try:
    if process_name is not None and reason is not None:
        send_message(f":computer: Computer: *{shared_utils.get_hostname()}*\n> :carpentry_saw: Process: *{process_name}*\n> :pencil2: Status: *{reason}*")

except Exception as e:
    logging.error(e)