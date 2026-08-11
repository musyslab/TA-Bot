# MAAT (formerly known as TA-Bot)

This project was originally developed and maintained by Jack Forden and Alex Gebhard.

It is currently maintained by Sam Mazzone.

# How to install MAAT (if on Windows)

## Install WSL Ubuntu

Download Ubuntu App from Windows Store

## Install packages:

In Ubuntu:

Update Packages:

```sudo apt update```

Install and verify npm is working:

```npm -v```

Install Docker (Follow instructions at: https://docs.docker.com/engine/install/ubuntu/)

## Install MAAT:

```git clone https://github.com/musyslab/MAAT.git```

Inside MAAT folder, make file named ```tabot.env``` Enter environment variables.

Go into frontend folder:

```npm install``` 

Still in the frontend folder, create a file named: ```.env```

Add the following line to that file: ```VITE_API_URL=http://localhost:5000/api``` (Or different URL for Production)

## Run MAAT

Go up a directory (from the frontend folder) and run:

```docker compose up```

It will take a while to compile the first time, but once it is ready navigate to the URL:

```http://localhost:3000/```

## View the local MAAT Database

Download DBDeaver: https://dbeaver.io/download/

In DBBeaver, connect to: ```localhost:3306```

## Pushing Docker Image to Production:

Get a github personal access token (PAT)

```export CR_PAT=<github personal access token>```

```echo $CR_PAT | docker login ghcr.io -u USERNAME --password-stdin```

```cd into the frontend/backend directory```

```docker build -f Dockerfile.prod -t ghcr.io/musyslab/tabot-<frontend/backend>:v<VERSION_NUMBER> .```

```docker push ghcr.io/musyslab/tabot-<frontend/backend>:v<VERSION_NUMBER>```
