import shared_utils
import customtkinter as ctk
import keyring
import logging
import tkinter.messagebox

class PromptSlackConfig:

    def __init__(self, master):
        self.master = master
        self.master.title(shared_utils.WINDOW_TITLES.get("prompt_slack_config"))
        #self.master.geometry("360x180")
        shared_utils.center_window(master, 420, 130)

        # Set a minimum size for the main frame
        #self.master.minsize(360, 200)

        # Create a layout/frame
        self.master.grid_rowconfigure(0, weight=1)
        self.master.grid_columnconfigure(0, weight=1)
        self.main_frame = ctk.CTkFrame(self.master, fg_color=shared_utils.FRAME_COLOR)
        self.main_frame.grid(row=0, column=0, sticky="nsew")

        # Configure the main_frame grid to center its children
        self.main_frame.grid_rowconfigure(0, weight=1)
        self.main_frame.grid_rowconfigure(1, weight=1)
        self.main_frame.grid_rowconfigure(2, weight=1)
        self.main_frame.grid_rowconfigure(3, weight=1)
        self.main_frame.grid_columnconfigure(0, weight=1)
        self.main_frame.grid_columnconfigure(1, weight=1)
        self.main_frame.grid_columnconfigure(2, weight=1)
        self.main_frame.grid_columnconfigure(3, weight=1)

        # Create a label and entry for "Bot User OAuth Token"
        self.bot_user_label = ctk.CTkLabel(self.main_frame, text="Slack Bot User OAuth Token:", fg_color=shared_utils.FRAME_COLOR)
        self.bot_user_label.grid(row=0, column=1, sticky='e', padx=5, pady=(20,5))
        self.bot_user_entry = ctk.CTkEntry(self.main_frame, placeholder_text="Enter Token", width=200)
        self.bot_user_entry.grid(row=0, column=2, sticky='w', padx=5, pady=(20,5))

        # Create a submit button
        self.submit_button = ctk.CTkButton(self.main_frame, text="Submit", command=self.submit)
        self.submit_button.grid(row=2, column=1, columnspan=2, padx=5, pady=(0, 10))

    def show_error(self, message):
        tkinter.messagebox.showerror("Error", message)

    def submit(self):
        bot_user_oauth_token = self.bot_user_entry.get()

        # Check if the token is empty
        if not bot_user_oauth_token:
            self.show_error("No token entered. Please enter a valid token.")
            return

        # Check if the token starts with "xoxb-"
        if not bot_user_oauth_token.startswith("xoxb-"):
            self.show_error("Incorrect token entered. Please enter a valid token (begins with 'xoxb-').")
            return

        # Store these securely using keyring
        keyring.set_password("Owlette", "SlackBotUserOAuthToken", bot_user_oauth_token)
        logging.info("Added Slack Bot User OAuth Token to Windows Credentials")
        # Return this value to the main GUI process (owlette_gui.py)
        print(bot_user_oauth_token)
        self.master.destroy()

if __name__ == "__main__":
    root = ctk.CTk()
    app = PromptSlackConfig(root)
    root.mainloop()