const {onRequest} = require("firebase-functions/v2/https");
const {onCall} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");


const dotenv = require("dotenv");
const axios = require("axios");
const admin = require("firebase-admin");
const {getStorage} = require("firebase-admin/storage");
const express = require("express");

// Initialize Firebase Admin SDK
admin.initializeApp();

// const storage = new Storage();
const app = express();

// Load environment variables from .env file
dotenv.config();

// locate all functions closest to users
setGlobalOptions({region: "europe-west1"});


// Using hardcoded API key for simplicity
// Authentication Middleware
const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.header("x-api-key");
  const validApiKey = process.env.API_KEY;

  // Replace 'YOUR_API_KEY' with the actual API key generated earlier
  if (!apiKey || apiKey !== validApiKey) {
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

  // Save the data to Firestore
  admin
      .firestore()
      .collection("stories")
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


/**
 * Downloads an image for a given story and saves it to Firebase Storage.
 * The function first adds an entry to the image_queue collection with a status of "started."
 * If the download is successful, the status is updated to "success."
 * If the download fails, the status is updated to "error," and the error message is saved.
 *
 * @param {Object} event - The Firestore event containing the story data.
 * @return {Promise} - A promise that resolves when the download is complete and the Firestore document is updated.
 */
function downloadImage(event) {
  // Retrieve the bucket URL from the environment variables
  const bucketUrl = process.env.BUCKET_URL;
  if (!bucketUrl) {
    console.error("Bucket URL is not defined in .env file");
    return Promise.reject(new Error("Bucket URL is missing"));
  }

  // Create a reference to the Firebase Storage bucket
  const bucket = getStorage().bucket(bucketUrl);

  // Retrieve the story data from the event
  const story = event.data.data();
  const imageUrl = story.image_versions2.candidates[0].url;

  // Extract the file extension from the imageUrl
  const fileExtension = "jpeg";

  // Set the destination file name in the bucket
  const destinationFileName = `stories/images/${story.user.username}/${story.id}.${fileExtension}`;

  // Create a queue entry with status "started" in the image_queue collection
  const imageQueueData = {
    storyId: story.id,
    imageUrl: imageUrl,
    status: "started",
    datetime: admin.firestore.FieldValue.serverTimestamp(),
  };

  const imageQueueRef = admin.firestore().collection("image_queue");

  // Add the queue entry to Firestore and start the download
  return imageQueueRef.add(imageQueueData)
      .then((docRef) => {
        console.log("Image download queued for story:", story.id);

        // Use axios to download the image
        return axios.get(imageUrl, {responseType: "arraybuffer"})
            .then((response) => {
              const imageBuffer = Buffer.from(response.data, "binary");
              const file = bucket.file(destinationFileName);

              // Save the image to the bucket
              return file.save(imageBuffer, {contentType: `image/${fileExtension}`})
                  .then(() => {
                    console.log("Image downloaded and saved to Firebase Storage:", destinationFileName);
                    // Update the queue entry with status "success"
                    return docRef.update({status: "success"});
                  })
                  .catch((error) => {
                    const errorMessage = "Error saving the image to Firebase Storage: " + error;
                    console.error(errorMessage);
                    // Update the queue entry with status "error" and the error message
                    return docRef.update({status: "error", errorMessage: errorMessage});
                  });
            })
            .catch((error) => {
              const errorMessage = "Error downloading the image: " + error;
              console.error(errorMessage);
              // Update the queue entry with status "error" and the error message
              return docRef.update({status: "error", errorMessage: errorMessage});
            });
      })
      .catch((error) => {
        console.error("Error adding image to queue:", error);
      });
}


/**
 * Downloads a video for a given story and saves it to Firebase Storage.
 * The function first adds an entry to the video_queue collection with a status of "started."
 * If the download is successful, the status is updated to "success."
 * If the download fails, the status is updated to "error," and the error message is saved.
 *
 * @param {Object} event - The Firestore event containing the story data.
 * @return {Promise} - A promise that resolves when the download is complete and the Firestore document is updated.
 */
function downloadVideo(event) {
  const bucketUrl = process.env.BUCKET_URL;
  if (!bucketUrl) {
    console.error("Bucket URL is not defined in .env file");
    return Promise.reject(new Error("Bucket URL is missing"));
  }

  const bucket = getStorage().bucket(bucketUrl);
  const story = event.data.data();

  if (!Object.hasOwn(story, "video_versions")) {
    return Promise.resolve(); // Return a resolved promise if there's nothing to do
  }

  const videoURL = story.video_versions[0].url;
  const fileExtension = "mp4";
  const destinationFileName = `stories/videos/${story.user.username}/${story.id}.${fileExtension}`;

  const videoQueueData = {
    storyId: story.id,
    videoURL: videoURL,
    status: "started",
    datetime: admin.firestore.FieldValue.serverTimestamp(),
  };

  const videoQueueRef = admin.firestore().collection("video_queue");

  return videoQueueRef.add(videoQueueData)
      .then((docRef) => {
        console.log("Video download queued for story:", story.id);

        return axios({
          url: videoURL,
          method: "GET",
          responseType: "stream",
        })
            .then((response) => {
              return new Promise((resolve, reject) => {
                const file = bucket.file(destinationFileName);
                const writeStream = file.createWriteStream({
                  metadata: {
                    contentType: `video/${fileExtension}`,
                  },
                });

                response.data.pipe(writeStream);

                writeStream.on("finish", () => {
                  console.log("Video downloaded and saved to Firebase Storage:", destinationFileName);
                  docRef.update({status: "success"}).then(resolve).catch(reject);
                });

                writeStream.on("error", (error) => {
                  const errorMessage = "Error saving the video to Firebase Storage: " + error;
                  console.error(errorMessage);
                  docRef.update({status: "error", errorMessage: errorMessage}).then(reject).catch(reject);
                });
              });
            })
            .catch((error) => {
              const errorMessage = "Error downloading the video: " + error;
              console.error(errorMessage);
              return docRef.update({status: "error", errorMessage: errorMessage});
            });
      })
      .catch((error) => {
        console.error("Error adding video to queue:", error);
      });
}



// Function to download image for a story
exports.downloadImage = onDocumentCreated("stories/{storyId}",
    (event) => downloadImage(event));

// Function to download video for a story
exports.downloadVideo = onDocumentCreated({
  document: "stories/{storyId}",
  memory: "512MiB",
},
(event) => downloadVideo(event));

// Expose Express API as a single Cloud Function:
exports.story = onRequest(app);

// Downloading a video is a long-running task, so we need to use a background function
exports.downloadVideoTask = onCall({memory: "512MiB"}, (data, context) => {
  // Extract the video data from the input
  const videoData = data.videoData;

  // Call the existing downloadVideo function
  return downloadVideo({data: {data: videoData}})
      .then(() => {
      // Update the status to "started" in the queue
        return admin.firestore().collection("video_queue").doc(videoData.id)
            .update({status: "started", datetime: admin.firestore.FieldValue.serverTimestamp()});
      })
      .catch((error) => {
        console.error("Error retrying video download:", error);
      // Handle the error as needed
      });
});

/* TODO: Need to use another way to trigger the action / download the videos since the token creation
  * does not work as expected. */
exports.videoJanitor = onSchedule("every 5 minutes", async (event) => {
  const videoQueueRef = admin.firestore().collection("video_queue");

  // You'll need to modify the way you call the downloadVideoTask function to include the custom token
  // This could involve modifying the client code or using an HTTP request with appropriate headers

  return videoQueueRef.where("status", "in", ["error", "started"])
      .get()
      .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          const videoData = doc.data();
          const status = videoData.status;
          const datetime = videoData.datetime.toDate();
          const elapsedTime = (new Date() - datetime) / 1000;

          if (status === "error" || (status === "started" && elapsedTime > 120)) {
            // Trigger the downloadVideoTask function without waiting for it to complete
            // You'll need to modify this part to include the custom token in the request
            admin.functions().httpsCallable("downloadVideoTask")({videoData: videoData})
                .catch((error) => {
                  console.error("Error triggering video download function:", error);
                });
          }
        });

        // Return a resolved promise since we're not waiting for the download functions to complete
        return Promise.resolve();
      })
      .catch((error) => {
        console.error("Error querying video queue:", error);
      });
});
