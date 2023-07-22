const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const uuid = require("uuid");

const admin = require("firebase-admin");
admin.initializeApp();

const express = require("express");
const app = express();

// Using hardcoded API key for simplicity
// Authentication Middleware
const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.header("x-api-key");

  // Replace 'YOUR_API_KEY' with the actual API key generated earlier
  if (!apiKey || apiKey !== "f6882379-38c0-4356-a612-093b1e2926de") {
    return res.status(401).json({error: "Unauthorized"});
  }

  next();
};

// Apply authentication middleware to all routes
app.use(apiKeyMiddleware);

// build multiple CRUD interfaces:
app.post("/add", (req, res) => (createStory(req, res)));

// build multiple CRUD interfaces:
app.post("/image", (req, res) => (downloadDummy(req, res)));

function createStory(req, res) {
  const data = req.body; // POST data received

  // Save the data to Firestore
  admin
      .firestore()
      .collection("stories") // Replace 'myData' with your collection name
      .add(data)
      .then((docRef) => {
        console.log("Document written with ID: ", docRef.id);
        downloadImage(data.id, data.image_versions2.candidates[0].url);
        res.status(200).send("Data saved successfully");
      })
      .catch((error) => {
        console.error("Error adding document: ", error);
        res.status(500).send("Error saving data");
      });
}

function downloadImage(storyId, imageUrl) {
  // Create a reference to the Firebase Storage bucket
  const bucket = admin.storage().bucket();

  // Extract the file extension from the imageUrl
  const fileExtension = "jpeg";

  // Set the destination file name with the proper file extension
  const destinationFileName = `stories/${storyId}.${fileExtension}`;

  console.log(destinationFileName);
  console.log(imageUrl);
  console.log(bucket);
}

function downloadDummy(req, res) {
  const id = uuid.v4();
  downloadImage(id, "https://placehold.co/600x400/EEE/31343C");
  res.status(200).send("Data saved successfully");
}

function documentAddedTrigger(event) {
  console.log("Document created:", event.params.storyId);
}

// Function to download image for a story
exports.downloadImage = onDocumentCreated("stories/{storyId}",
    (event) => documentAddedTrigger(event));

// Expose Express API as a single Cloud Function:
exports.stories = onRequest(app);
