const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const axios = require("axios");
const admin = require("firebase-admin");
const {getStorage} = require("firebase-admin/storage");
const express = require("express");

// Initialize Firebase Admin SDK
admin.initializeApp();
// const storage = new Storage();
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

// Add a story to Firestore
app.post("/add", (req, res) => (createStory(req, res)));

function createStory(req, res) {
  const data = req.body; // POST data received

  // Check if entry already exists
  // admin
  //     .firestore()
  //     .collection("stories")
  //     .doc(data.id)
  //     .get()
  //     .then((doc) => {
  //       if (doc.exists) {
  //         console.log("Document already exists:", doc.id);
  //         return res.status(400).send("Document already exists");
  //       } else {
  //         console.log("Document does not exist:", doc.id);
  //         return saveStory(data, res);
  //       }
  //     })

  // Save the data to Firestore
  admin
      .firestore()
      .collection("stories") // Replace 'myData' with your collection name
      .doc(data.id)
      .set(data)
      .then((docRef) => {
        res.status(200).send("Data saved successfully");
      })
      .catch((error) => {
        console.error("Error adding document: ", error);
        res.status(500).send("Error saving data");
      });
}

function downloadImage(event) {
  // Create a reference to the Firebase Storage bucket
  const bucket = getStorage().bucket("gs://zeeschuimer-ig-loader.appspot.com");
  const story = event.data.data();
  const imageUrl = story.image_versions2.candidates[0].url;

  console.log("Downloading image for story:", imageUrl);

  // Extract the file extension from the imageUrl
  const fileExtension = "jpeg";

  // Set the destination file name with the proper file extension
  const destinationFileName =
  `stories/images/${story.user.username}/${story.id}.${fileExtension}`;

  // Download the image and save it to the Firebase Storage bucket
  return axios
      .get(imageUrl, {responseType: "arraybuffer"})
      .then((response) => {
        const imageBuffer = Buffer.from(response.data, "binary");
        const file = bucket.file(destinationFileName);
        file.save(imageBuffer, {
          contentType: `image/${fileExtension}`,
        })
            .then(() => {
              console.log("Image downloaded and saved to Firebase Storage:",
                  destinationFileName);
            })
            .catch((error) => {
              console.error("Error saving the image to Firebase Storage:",
                  error);
            });
      })
      .catch((error) => {
        console.error("Error downloading the image:", error);
      });
}


function downloadVideo(event) {
  // Create a reference to the Firebase Storage bucket
  const bucket = getStorage().bucket("gs://zeeschuimer-ig-loader.appspot.com");
  const story = event.data.data();

  // Check for video_versions in the story object
  if (!Object.hasOwn(story, "video_versions")) {
    return;
  }

  const videoURL = story.video_versions[0].url;

  console.log("Downloading video for story:", videoURL);

  // Extract the file extension from the imageUrl
  const fileExtension = "mp4";

  // Set the destination file name with the proper file extension
  const destinationFileName =
    `stories/videos/${story.user.username}/${story.id}.${fileExtension}`;

  return axios({
    url: videoURL,
    method: "GET",
    responseType: "stream",
  })
      .then((response) => {
        const file = bucket.file(destinationFileName);
        response.data.pipe(
            file.createWriteStream({
              metadata: {
                contentType: `video/${fileExtension}`,
              },
            })
        )
            .on("finish", () => {
              console.log("Image downloaded and saved to Firebase Storage:",
                  destinationFileName);
            })
            .on("error", (error) => {
              console.error("Error saving the image to Firebase Storage:",
                  error);
            });
      })
      .catch((error) => {
        console.error("Error downloading the image:", error);
      });
}


// Function to download image for a story
exports.downloadImage = onDocumentCreated("stories/{storyId}",
    (event) => downloadImage(event));

// Function to download video for a story
exports.downloadVideo = onDocumentCreated("stories/{storyId}",
    (event) => downloadVideo(event));
// Expose Express API as a single Cloud Function:
exports.story = onRequest(app);
