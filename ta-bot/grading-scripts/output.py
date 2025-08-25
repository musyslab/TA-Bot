#!/usr/bin/python3
import os, glob, re

TYPE_CONFIG_KEY="TYPE"
DESCRIPTION_CONFIG_KEY="DESCRIPTION"
HIDDEN_CONFIG_KEY="HIDDEN"

def createTapFile(output_file):
    with open(output_file, "w") as file:
        file.write("TAP version 13\n")

def end_tap_file(output_file, temp_directory):
    tests = glob.glob1(temp_directory, '*.info')
    with open(output_file, "a") as file:
        file.write(f"1..{str(len(tests))}\n")
    return output_file
    
def add_test_to_tap(output_file, directory, test):
    test_path = os.path.join(directory, test)
    config = parseTestConfig(test_path)
    with open(output_file, "a") as file:
        if config == -1:
            file.write("not ok # SKIP Could not parse test config file.  Please contact the instructor" + "\n")
            return
        if not TYPE_CONFIG_KEY in config:
            file.write("not ok # SKIP Missing TYPE setting in test config.  Please contact the instructor" + "\n")
            return
        if not DESCRIPTION_CONFIG_KEY in config:
            file.write("not ok # SKIP Missing DESCRIPTION setting in test config.  Please contact the instructor" + "\n")
            return

def parseTestConfig(test_path):
    config = {}
    with open(test_path, "r") as test_file:
        for line in test_file:
            m = re.match("([a-zA-Z]+)=(.*)", line)
            if m:
                config[m.group(1)] = m.group(2)
            else:
                return -1
    return config