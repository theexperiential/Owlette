import os

def get_path(filename=None):
    # Get the directory of the currently executing script
    path = os.path.dirname(os.path.realpath(__file__))

    # Build the full path to the file name
    if filename is not None:
        path = os.path.join(path, filename)

    return path

def generateConfigFile():
    config = {'processes': [], 'email': {'from': '', 'to': []}}
    return config