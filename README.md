<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/09abe258-34ec-44bb-bd8a-a78896fcb135

## Run On GitHub

This repo is configured to deploy to GitHub Pages automatically when you push to `main`.

After GitHub Pages is enabled for this repository, the app will be available at:

`https://zhuyanhe1975-hit.github.io/LoongEnv_IDE/`

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
