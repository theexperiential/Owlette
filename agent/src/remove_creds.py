import keyring

try:
    keyring.delete_password("Owlette", "GmailRefreshToken")
    keyring.delete_password("Owlette", "SlackBotUserOAuthToken")
    keyring.delete_password("Owlette", "ChannelID")
    print("Credentials removed successfully.")
except keyring.errors.PasswordDeleteError:
    print("Failed to remove one or more credentials.")
