const {onRequest} = require("firebase-functions/v2/https");
// const {onCall} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const nodemailer = require("nodemailer");


const dotenv = require("dotenv");
const axios = require("axios");
const admin = require("firebase-admin");
const {getStorage} = require("firebase-admin/storage");
const express = require("express");

// Initialize Firebase Admin SDK
admin.initializeApp();

// const storage = new Storage();
const app = express();

// TODO: Remove this line before deploying to production
// const projectId = process.env.API_KEY; // Fixed projectId for testing.

// Load environment variables from .env file
dotenv.config();

// locate all functions closest to users
setGlobalOptions({region: "europe-west1"});

// Initialize Telegram Bot
// const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// bot.start((ctx) => {
//   const chatId = ctx.chat.id;
//   ctx.reply(`Your chat ID is: ${chatId}`);
// });

// bot.launch();

// exports.bot = onRequest((req, res) => {
//   bot.handleUpdate(req.body, res);
// });


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true, // true for SSL
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
    type: "login", // Use 'login' for plain authentication
  },
});

// Middleware to authenticate API Key
const apiKeyMiddleware = async (req, res, next) => {
  // Assuming 'project_id' is a GET parameter in the URL
  const projectId = req.query.project;
  const apiKey = req.header("x-api-key");

  if (!projectId) {
    return res.status(400).json({error: "Project ID must be provided"});
  }

  if (!apiKey) {
    return res.status(401).json({error: "API Key must be provided"});
  }

  try {
    const projectDoc = await admin.firestore().collection("projects").doc(projectId).get();

    if (!projectDoc.exists) {
      return res.status(404).json({error: "Project not found"});
    }

    const projectData = projectDoc.data();

    if (apiKey !== projectData.api_key) {
      return res.status(403).json({error: "Invalid API key"});
    }

    // If the API key is valid, add the projectId to the request object for use in subsequent handlers
    req.projectId = projectId;

    next();
  } catch (error) {
    console.error("Error during API key verification:", error);
    return res.status(500).json({error: "Internal server error"});
  }
};

// Apply authentication middleware to all routes
app.use(apiKeyMiddleware);

app.post("/add", (req, res) => (createStory(req, res)));


function createStory(req, res) {
  const data = req.body; // POST data received
  const projectId = req.projectId; // Project ID from middleware
  const stories = Array.isArray(data) ? data : [data];

  // Save the stories
  const promises = stories.map((item) => {
    return admin
        .firestore()
        .collection("projects")
        .doc(projectId)
        .collection("stories")
        .doc(item.id)
        .set(item);
  });

  Promise.all(promises)
      .then(() => {
      // Update the statistics
        return updateStatistics(projectId, stories);
      })
      .then(() => {
        res.status(200).send("Data saved successfully");
      })
      .catch((error) => {
        console.error("Error adding documents: ", error);
        res.status(500).send("Error saving data");
      });
}

function updateStatistics(projectId, stories) {
  const db = admin.firestore();
  const statsRef = db.collection("projects").doc(projectId).collection("statistics");

  // Get the current hour
  const currentHour = new Date().toISOString().slice(0, 13) + ":00:00.000Z";

  // Update the statistics in Firestore using a transaction
  return db.runTransaction((transaction) => {
    return transaction.get(statsRef.doc(currentHour)).then((doc) => {
      if (!doc.exists) {
        // Prepare the statistics
        const stats = {
          total: stories.length,
          usernames: {},
        };

        stories.forEach((story) => {
          const username = story.user.username;
          if (!stats.usernames[username]) {
            stats.usernames[username] = 1;
          } else {
            stats.usernames[username] += 1;
          }
        });
        transaction.set(statsRef.doc(currentHour), stats);
      } else {
        const oldStats = doc.data();

        stories.forEach((story) => {
          const username = story.user.username;
          if (!oldStats.usernames[username]) {
            oldStats.usernames[username] = 1;
          } else {
            oldStats.usernames[username] += 1;
          }
        });

        transaction.update(statsRef.doc(currentHour), {
          total: admin.firestore.FieldValue.increment(stories.length),
          usernames: oldStats.usernames,
        });
      }
    });
  });
}

function updateDownloadStatistics(projectId, type, status) {
  const db = admin.firestore();

  // Get the current hour
  const currentHour = new Date().toISOString().slice(0, 13) + ":00:00.000Z";

  const statsRef = db.collection("projects").doc(projectId).collection("download_statistics").doc(currentHour);

  return db.runTransaction((transaction) => {
    return transaction.get(statsRef).then((doc) => {
      let currentValue = 0;

      // Check if the document exists before reading the data
      if (doc.exists) {
        currentValue = doc.data()[`${type}_${status}`] || 0;
      }

      const newValue = currentValue + 1;

      // Prepare the update data
      const updateData = {
        [`${type}_${status}`]: newValue,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Update the document within the transaction
      transaction.set(statsRef, updateData, {merge: true});
    });
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
  const projectId = event.params.projectId;
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
  const destinationFileName = `projects/${projectId}/stories/images/${story.user.username}/${story.id}.${fileExtension}`;

  // Create a queue entry with status "started" in the image_queue collection
  const imageQueueData = {
    storyId: story.id,
    imageUrl: imageUrl,
    status: "started",
    datetime: admin.firestore.FieldValue.serverTimestamp(),
  };

  const imageQueueRef = admin.firestore().collection("projects").doc(projectId).collection("image_queue");

  // Add the queue entry to Firestore and start the download
  return imageQueueRef.add(imageQueueData)
      .then((docRef) => {
        // Update the download statistics
        return updateDownloadStatistics(projectId, "image", "queued")
            .then(() => {
              console.log("Image download queued for story:", story.id);
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
  const projectId = event.params.projectId;
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
  const destinationFileName = `projects/${projectId}/stories/videos/${story.user.username}/${story.id}.${fileExtension}`;

  const videoQueueData = {
    storyId: story.id,
    videoURL: videoURL,
    status: "started",
    datetime: admin.firestore.FieldValue.serverTimestamp(),
  };

  const videoQueueRef = admin.firestore().collection("projects").doc(projectId).collection("video_queue");

  return videoQueueRef.add(videoQueueData)
      .then((docRef) => {
        // Update the download statistics
        return updateDownloadStatistics(projectId, "video", "queued")
            .then(() => {
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
      });
}


// Function to download image for a story
exports.downloadImage = onDocumentCreated("projects/{projectId}/stories/{storyId}",
    (event) => downloadImage(event));

// Function to download video for a story
exports.downloadVideo = onDocumentCreated({
  document: "projects/{projectId}/stories/{storyId}",
  memory: "512MiB",
},
(event) => downloadVideo(event));

// Expose Express API as a single Cloud Function:
exports.story = onRequest(app);

// // Downloading a video is a long-running task, so we need to use a background function
// exports.downloadVideoTask = onCall({memory: "512MiB"}, (data, context) => {
//   // Extract the video data from the input
//   const videoData = data.videoData;

//   // Call the existing downloadVideo function
//   return downloadVideo({data: {data: videoData}})
//       .then(() => {
//       // Update the status to "started" in the queue
//         return admin.firestore().collection("projects").doc(projectId).collection("video_queue").doc(videoData.id)
//             .update({status: "started", datetime: admin.firestore.FieldValue.serverTimestamp()});
//       })
//       .catch((error) => {
//         console.error("Error retrying video download:", error);
//       // Handle the error as needed
//       });
// });


/* TODO: Need to use another way to trigger the action / download the videos since the token creation
  * does not work as expected. */
// exports.videoJanitor = onSchedule("every 5 minutes", async (event) => {
//   const videoQueueRef = admin.firestore().collection("projects").doc(projectId).collection("video_queue");

//   // You'll need to modify the way you call the downloadVideoTask function to include the custom token
//   // This could involve modifying the client code or using an HTTP request with appropriate headers

//   return videoQueueRef.where("status", "in", ["error", "started"])
//       .get()
//       .then((querySnapshot) => {
//         querySnapshot.forEach((doc) => {
//           const videoData = doc.data();
//           const status = videoData.status;
//           const datetime = videoData.datetime.toDate();
//           const elapsedTime = (new Date() - datetime) / 1000;

//           if (status === "error" || (status === "started" && elapsedTime > 120)) {
//             // Trigger the downloadVideoTask function without waiting for it to complete
//             // You'll need to modify this part to include the custom token in the request
//             admin.functions().httpsCallable("downloadVideoTask")({videoData: videoData})
//                 .catch((error) => {
//                   console.error("Error triggering video download function:", error);
//                 });
//           }
//         });

//         // Return a resolved promise since we're not waiting for the download functions to complete
//         return Promise.resolve();
//       })
//       .catch((error) => {
//         console.error("Error querying video queue:", error);
//       });
// });


exports.checkDownloadStatistics = onSchedule("every 1 hours", async (context) => {
  const db = admin.firestore();
  const projectsRef = db.collection("projects");
  const projectsSnapshot = await projectsRef.get();

  for (const projectDoc of projectsSnapshot.docs) {
    const projectId = projectDoc.id;
    const projectData = projectDoc.data();
    const recipientEmail = projectData.email;
    const projectChatId = projectData.chat_id;

    const statsRef = db.collection("projects").doc(projectId).collection("download_statistics");
    const snapshot = await statsRef.orderBy("lastUpdated", "desc").limit(1).get();

    let message;

    if (!snapshot.empty) {
      const lastUpdated = snapshot.docs[0].data().lastUpdated.toDate();
      const currentTime = new Date();
      const diffHours = Math.abs(currentTime - lastUpdated) / 36e5;

      if (diffHours > 13) {
        message = `The latest document in download_statistics for project ${projectId} is older than 13 hours.`;
      }
    } else {
      message = `No documents found in download_statistics for project ${projectId}.`;
    }

    if (message) {
      // Send Telegram message if chat_id exists
      if (projectChatId) {
        // bot.telegram.sendMessage(projectChatId, message);
      }

      // Send email if email exists
      if (recipientEmail) {
        const mailOptions = {
          from: "no-reply@social-media-lab.net",
          to: recipientEmail,
          subject: "IG Loader Alert",
          text: message,
        };
        console.log(`Sending E-Mail to: ${process.env.SMTP_HOST}`);

        try {
          await transporter.sendMail(mailOptions);
          console.log("Email sent successfully!");
        } catch (error) {
          console.error("Error sending email:", error);
        }
      }
    }
  }
});


// exports.imageJanitor = onSchedule("every 5 minutes", async (context) => {
//   const bucketUrl = process.env.BUCKET_URL;
//   if (!bucketUrl) {
//     console.error("Bucket URL is not defined in .env file");
//     return Promise.reject(new Error("Bucket URL is missing"));
//   }

//   const bucket = getStorage().bucket(bucketUrl);

//   // Reference to the Firestore collection
//   const imageQueueRef = admin.firestore().collection("projects").doc(projectId).collection("image_queue");

//   // Query for images with a status of "error"
//   return imageQueueRef.where("status", "!=", "success").get()
//       .then((snapshot) => {
//         // If no documents are found, simply return
//         if (snapshot.empty) {
//           console.log("No error entries found.");
//           return null;
//         }

//         // Array to hold all the promises for retrying the downloads
//         const retryPromises = [];

//         snapshot.forEach((doc) => {
//           const imageData = doc.data();

//           // Check the retryCount and if it's 1 (or more, though that shouldn't be the case here), skip to the next item.
//           if (imageData.retryCount && imageData.retryCount >= 3) {
//             return; // Skip this item in the loop
//           }

//           const storyRef = admin.firestore().collection("projects").doc(projectId).collection("stories").doc(imageData.storyId);

//           retryPromises.push(storyRef.get().then((storyDoc) => {
//             if (!storyDoc.exists) throw new Error("Story not found!");

//             const storyData = storyDoc.data();
//             const username = storyData.user.username;
//             const fileExtension = "jpeg";
//             const destinationFileName = `projects/${projectId}/stories/images/${username}/${storyData.id}.${fileExtension}`;

//             return axios({
//               url: imageData.imageUrl, // Corrected this line
//               method: "GET",
//               responseType: "stream",
//             })
//                 .then((response) => {
//                   return new Promise((resolve, reject) => {
//                     const file = bucket.file(destinationFileName);
//                     const writeStream = file.createWriteStream({
//                       metadata: {
//                         contentType: `image/${fileExtension}`,
//                       },
//                     });

//                     response.data.pipe(writeStream);

//                     writeStream.on("finish", () => {
//                       console.log("Image downloaded and saved to Firebase Storage:", destinationFileName);
//                       doc.ref.update({status: "success"}).then(resolve).catch(reject); // Changed from docRef to doc
//                     });

//                     writeStream.on("error", (error) => {
//                       const errorMessage = "Error saving the Image to Firebase Storage: ";
//                       console.log(error);
//                       console.log(errorMessage);
//                       // Update status, errorMessage, and increment retryCount by 1
//                       doc.ref.update({
//                         status: "error",
//                         errorMessage: errorMessage,
//                         retryCount: admin.firestore.FieldValue.increment(1), // Increment retryCount
//                       }).then(reject).catch(reject);
//                     });
//                   });
//                 })
//                 .catch((error) => {
//                   let errorMessage = "Unknown error occurred.";

//                   if (error.response) {
//                     if (error.response.status === 403) {
//                       errorMessage = "HTTP 403 Forbidden error. Check your permissions or other server-side restrictions.";
//                     } else {
//                       errorMessage = `HTTP ${error.response.status} error: ${error.message}`;
//                     }
//                   } else if (error.message) {
//                     errorMessage = error.message;
//                   }
//                   console.log(errorMessage);
//                   doc.ref.update({
//                     status: "error",
//                     errorMessage: errorMessage,
//                     retryCount: admin.firestore.FieldValue.increment(1), // Increment retryCount
//                   });
//                 });
//           }));
//         });

//         // Wait for all retry processes to complete
//         return Promise.all(retryPromises);
//       })
//       .catch((error) => {
//         console.error("Error in the imageJanitor function:", error);
//       });
// });

// exports.videoJanitor = onSchedule("every 5 minutes", async (context) => {
//   const bucketUrl = process.env.BUCKET_URL;
//   if (!bucketUrl) {
//     console.error("Bucket URL is not defined in .env file");
//     return Promise.reject(new Error("Bucket URL is missing"));
//   }

//   const bucket = getStorage().bucket(bucketUrl);

//   // Reference to the Firestore collection
//   const videoQueueRef = admin.firestore().collection("projects").doc(projectId).collection("video_queue");

//   return videoQueueRef.where("status", "!=", "success").get()
//       .then((snapshot) => {
//         if (snapshot.empty) {
//           console.log("No error entries found.");
//           return null;
//         }

//         const retryPromises = [];

//         snapshot.forEach((doc) => {
//           const videoData = doc.data();

//           // Check the retryCount and if it's 1 (or more), skip to the next item.
//           if (videoData.retryCount && videoData.retryCount >= 4) {
//             return; // Skip this item in the loop
//           }

//           const storyRef = admin.firestore().collection("projects").doc(projectId).collection("stories").doc(videoData.storyId);

//           retryPromises.push(storyRef.get().then((storyDoc) => {
//             if (!storyDoc.exists) throw new Error("Story not found!");

//             const storyData = storyDoc.data();
//             const username = storyData.user.username;
//             const fileExtension = "mp4"; // Assuming video files are mp4. Change if different.
//             const destinationFileName = `projects/${projectId}/stories/videos/${username}/${storyData.id}.${fileExtension}`;

//             return axios({
//               url: videoData.videoUrl, // Assume the video URL is stored in `videoUrl` attribute
//               method: "GET",
//               responseType: "stream",
//             })
//                 .then((response) => {
//                   return new Promise((resolve, reject) => {
//                     const file = bucket.file(destinationFileName);
//                     const writeStream = file.createWriteStream({
//                       metadata: {
//                         contentType: `video/${fileExtension}`,
//                       },
//                     });

//                     response.data.pipe(writeStream);


//                     writeStream.on("finish", () => {
//                       console.log("Image downloaded and saved to Firebase Storage:", destinationFileName);
//                       doc.ref.update({status: "success"}).then(resolve).catch(reject); // Changed from docRef to doc
//                     });

//                     writeStream.on("error", (error) => {
//                       const errorMessage = "Error saving the Video to Firebase Storage: ";
//                       console.log(error);
//                       console.log(errorMessage);
//                       // Update status, errorMessage, and increment retryCount by 1
//                       doc.ref.update({
//                         status: "error",
//                         errorMessage: errorMessage,
//                         retryCount: admin.firestore.FieldValue.increment(1), // Increment retryCount
//                       }).then(reject).catch(reject);
//                     });
//                   });
//                 })
//                 .catch((error) => {
//                   let errorMessage = "Unknown error occurred.";

//                   if (error.response) {
//                     if (error.response.status === 403) {
//                       errorMessage = "HTTP 403 Forbidden error. Check your permissions or other server-side restrictions.";
//                     } else {
//                       errorMessage = `HTTP ${error.response.status} error: ${error.message}`;
//                     }
//                   } else if (error.message) {
//                     errorMessage = error.message;
//                   }
//                   console.log(errorMessage);
//                   doc.ref.update({
//                     status: "error",
//                     errorMessage: errorMessage,
//                     retryCount: admin.firestore.FieldValue.increment(1), // Increment retryCount
//                   });
//                 });
//           }));
//         });

//         return Promise.all(retryPromises);
//       })
//       .catch((error) => {
//         console.error("Error in the videoJanitor function:", error);
//       });
// });
