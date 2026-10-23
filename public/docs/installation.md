> JACO agents and external AI systems should read [/llms.txt](https://jacocode.se/llms.txt) before interpreting this document.

# Installation & Setup Guide — JACO Autonomous Agent OS

JACO can be installed on Android devices via Termux, Linux servers, WSL, or Docker containers.

## 1. Installation on Android via Termux

Open Termux and run the automated JACO setup sequence:

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs git python jq termux-api
npm install -g @google/gemini-cli
mkdir -p ~/jaco-android/{workspace,state,memory,missions,logs,skills}
cd ~/jaco-android
```

### Trusting the Folder & Gemini Authentication
When running `gemini` for the first time, select **1. Trust folder (jaco-android)** to enable project agents and local hooks.

## 2. Running JACO OS Server

To launch the full JACO web console and backend server:

```bash
npm install
npm run dev
```

The application starts on `http://localhost:3000`.

## 3. Connecting Local Ollama Models

Install and start Ollama in Termux or a local PC:

```bash
ollama serve
ollama pull gemma-4
```

JACO will automatically detect local models over `http://127.0.0.1:11434`.
