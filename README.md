# TA-Bot

This project was originally developed and maintained by Jack Forden and Alex Gebhard.

It is currently maintained by Sam Mazzone.

# How to install TA-Bot

## Install WSL Ubuntu

Download Ubuntu App from Windows Store

Launch Ubuntu App

Make username/password

Make Ubuntu Default (Optional). Open a CMD terminal and type: ```wsl --set-default Ubuntu```

## Install packages:

In Ubuntu:

Update Packages:

```sudo apt update```

Install Node.js

```nvm install --latest-npm```

Verify node/npm is working

```node -v```

```npm -v```

Install yarn:

```npm install --global yarn```

Install Docker (Follow instructions at: https://docs.docker.com/engine/install/ubuntu/)

Make it so you don't have to run sudo everytime in docker:

```sudo usermod -aG docker $USER```

```source ~/.bashrc```

```newgrp docker```

```docker run hello-world```

## Install TA-Bot:

```git clone https://github.com/Sam-Mazzone/TA-Bot.git```

Enter Github username and personal access token (not password)

Go into UI folder:

```yarn install```

```npm install``` 

## Run TA-Bot

Go up a directory (from the UI folder) and run:

```docker compose up```

It will take a while to compile the first time, but once it is ready navigate to the URL:

```http://localhost:3000/```

## View the local TA-Bot Database

Download DBDeaver: https://dbeaver.io/download/

In DBBeaver, connect to: ```localhost:3306```

## Setup Database for First Time Use

Currently, manual setup required. Classes, lectures, and labs need to be manually added

## Commands for Sam when he's dumb

```wsl --list```

```wsl --unregister <distro-name>```

```(wsl --unregister Ubuntu)```