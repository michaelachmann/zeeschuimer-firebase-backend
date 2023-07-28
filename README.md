# Zeeschuimer Firebase Backend

This repository contains the backend code built on Firebase Functions and an Express API for handling Instagram Stories and Reels data. The functions interact with the [Zeeschuimer-F](https://github.com/michaelachmann/zeeschuimer-f) plugin that collects data while browsing Instagram. Please note that a frontend application is yet to be developed to provide a user interface for accessing and interacting with this backend.

## Prerequisites

Before using the functions in this repository, make sure you have the following installed:

1. Node.js and npm (Node Package Manager)
2. Firebase CLI (Command Line Interface)

## Setup

1. Clone this repository to your local machine.
2. Install the required dependencies by running the following command in the repository's root directory:

```bash
npm install
```

3. Create a `.env` file in the root directory and add the following environment variable:

```
API_KEY=YOUR_API_KEY
```

Replace `YOUR_API_KEY` with your desired API key for authentication.

4. Initialize the Firebase project using the Firebase CLI. If you haven't installed it yet, you can do so by running:

```bash
npm install -g firebase-tools
```

Then, authenticate and initialize your Firebase project:

```bash
firebase login
firebase init
```

5. Deploy the Firebase Functions to the cloud:

```bash
firebase deploy --only functions
```

## Functions

### Add a Story

Endpoint: `POST /add`

This function allows you to add a new story to Firestore. Send a POST request to the `/add` endpoint with the story data in the request body, and it will be saved to the Firestore collection named "stories".

### Download Image for a Story

This function is triggered whenever a new document is created in the "stories" collection in Firestore. It will automatically download the image associated with the story and save it to the Firebase Storage bucket. The function is deployed under the name `downloadImage`.

### Download Video for a Story

This function is also triggered whenever a new document is created in the "stories" collection in Firestore. It will check if the story contains video_versions and then download the video and save it to the Firebase Storage bucket. In case of any error during the process, it will add an error entry to the "video_queue" collection in Firestore. The function is deployed under the name `downloadVideo`.

### Authentication Middleware

The Express API is protected by an authentication middleware. All routes are protected, and you must include the `x-api-key` header with a valid API key to access the endpoints.

## License

This repository is licensed under the MIT License. Please see the [LICENSE](LICENSE) file for more details.

## Frontend (Work in Progress)

Please note that the frontend application for accessing and interacting with this backend is still under development. Once completed, it will provide a user-friendly interface to view, manage, and interact with Instagram Stories and Reels data.

Stay tuned for further updates on the frontend development!

## Deployed Functions

The functions in this repository have been deployed to the Firebase cloud and are accessible via the following URLs:

- `POST https://YOUR_PROJECT_ID.cloudfunctions.net/story/add`
  (Replace `YOUR_PROJECT_ID` with your actual Firebase project ID)

## Additional Notes

- The Firebase Admin SDK is initialized at the beginning of the code, enabling access to Firestore and Firebase Storage.
- The functions are set to run in the "europe-west1" region. You can change this region by modifying the `setGlobalOptions` configuration in the code.
- Videos are downloaded asynchronously, and any errors during the process are handled gracefully.

Please refer to the official Firebase documentation for more information on how to use and manage Firebase Functions: [Firebase Functions Documentation](https://firebase.google.com/docs/functions).