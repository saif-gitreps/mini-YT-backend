const asyncHandler = require("../utils/async-handler");
const Video = require("../models/video.model");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const mongoose = require("mongoose");
const {
   uploadOnCloudinary,
   deleteFromCloudinary,
   retrievePublicIdFromUrl,
} = require("../utils/cloudinary");

// task left : add left join for likes and comments on videos.

const getAllVideos = asyncHandler(async (req, res) => {
   const { page = 1, limit = 3, query, sortBy, sortType, userId } = req.body;

   // sort types: views, createdAt, duration, title + isPublished videos only.
   const skip = (page - 1) * limit;

   const match = {};
   if (query) {
      match.$text = { $search: query };
      match[isPublished] = true;
      if (userId) {
         match.owner = new mongoose.Types.ObjectId(userId);
      }
   }

   const sort = {};
   if (sortBy && (parseInt(sortType) === 1 || parseInt(sortType) === -1)) {
      sort[sortBy] = parseInt(sortType);
   } else {
      // if no sort by was sent, then ill sort it by recent.
      sort["createdAt"] = 1;
   }

   const videos = await Video.aggregate([
      {
         $match: match,
      },
      {
         $sort: sort,
      },
      {
         $skip: skip,
      },
      {
         $limit: limit,
      },
      {
         $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "owner",
         },
      },
      {
         // another way of de constructing the array it seems.
         $unwind: "$owner",
      },
      {
         $project: {
            _id: 1,
            videoFile: 1,
            thumbnail: 1,
            owner: {
               _id: 1,
               username: 1,
            },
            title: 1,
            duration: 1,
            createdAt: 1,
         },
      },
   ]);

   if (!videos.length || !videos) {
      throw new ApiError(404, "No videos found");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, videos, "Successfully fetched videos based on query."));
});

const publishAVideo = asyncHandler(async (req, res) => {
   const { title, description } = req.body;

   if (!title && !description) {
      throw new ApiError(400, "Title and Description are required.");
   }

   const thumbnailLocalPath = req.files.thumbnail[0].path;
   const videoLocalPath = req.files.video[0].path;

   if (!thumbnailLocalPath) {
      throw new ApiError(400, "Thumnail is required.");
   }
   if (!videoLocalPath) {
      throw new ApiError(400, "Video is required.");
   }

   const uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath);
   const uploadedVideo = await uploadOnCloudinary(videoLocalPath);

   if (!uploadedThumbnail.url && !uploadedVideo.url) {
      throw new ApiError(
         400,
         "Failure while uploading thumbnail or video on Cloud.Try again!"
      );
   }

   const newVideo = await Video.create({
      videoFile: uploadedVideo?.url,
      thumbnail: uploadedThumbnail?.url,
      title: title,
      description: description,
      duration: uploadedVideo.duration,
      owner: req.user._id,
   });

   if (!newVideo) {
      throw new ApiError(400, "failure uploading video on the platfrom.");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, newVideo, "Video uploaded successfully."));
});

const getVideo = asyncHandler(async (req, res) => {
   const { videoId } = req.params;

   // task left in this controller: after making likes and comments controller , convert the result to
   // object.
   const video = await Video.aggregate([
      {
         $match: {
            _id: new mongoose.Types.ObjectId(videoId),
            isPublished: true,
         },
      },
      {
         $lookup: {
            from: "users",
            foreignField: "_id",
            localField: "owner",
            as: "owner",
            pipeline: [
               {
                  $project: {
                     _id: 1,
                     username: 1,
                     avatar: 1,
                  },
               },
            ],
         },
      },
      {
         $lookup: {
            from: "comments",
            foreignField: "video",
            localField: "_id",
            as: "commentsOnTheVideo",
            // wont undwind this cuz i need the array of comments.
            pipeline: [
               {
                  $lookup: {
                     from: "users",
                     localField: "owner",
                     foreignField: "_id",
                     as: "owner",
                  },
               },
               {
                  $unwind: "$owner",
               },
               {
                  $project: {
                     _id: 1,
                     content: 1,
                     owner: {
                        _id: 1,
                        username: 1,
                        avatar: 1,
                     },
                     createdAt: 1,
                  },
               },
            ],
         },
      },
      {
         $lookup: {
            from: "likes",
            foreignField: "video",
            localField: "_id",
            as: "likesOnTheVideo",
         },
      },
      {
         $addFields: {
            owner: {
               $first: "$owner",
            },
            numberOfLikes: {
               $size: "$likesOnTheVideo",
            },
         },
      },
      {
         $unset: "likesOnTheVideo",
      },
   ]);

   if (!video || !video.length) {
      throw new ApiError(400, "No such video exists");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, video[0], "Video fetched successfully"));
});

const updateVideoDetails = asyncHandler(async (req, res) => {
   const { videoId } = req.params;
   const { title, description } = req.body;

   if (!title || !description) {
      throw new ApiError(400, "Please dont keep any fields empty.");
   }

   const video = await Video.findByIdAndUpdate(
      {
         _id: videoId,
      },
      {
         $set: {
            title: title,
            description: description,
         },
      },
      {
         new: true,
      }
   );

   if (!video || !video.length) {
      throw new ApiError(400, "no such video exists to update.");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, video, "Video details updated successfully."));
});

const updateVideoThumbnail = asyncHandler(async (req, res) => {
   const { videoId } = req.params;
   const thumbnailLocalPath = req.file?.path;

   if (!thumbnailLocalPath) {
      throw new ApiError(400, "thumbnail was not received by the server.");
   }

   const uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath);

   if (!uploadedThumbnail.url) {
      throw new ApiError(400, "Failure uploading thumbnail to cloudinary.");
   }

   let video = await Video.findById(videoId);

   if (video.thumbnail) {
      await deleteFromCloudinary(
         // made this alogorithm hehe and it works great.
         retrievePublicIdFromUrl(video.thumbnail).trim()
      );
   }

   video = await Video.findByIdAndUpdate(
      {
         _id: videoId,
      },
      {
         $set: {
            thumbnail: uploadedThumbnail.url,
         },
      },
      {
         new: true,
      }
   );

   if (!video || !video.length) {
      throw new ApiError(400, "no such video exists to update.");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, video, "Video thumbnail updated successfully."));
});

const deleteVideo = asyncHandler(async (req, res) => {
   const { videoId } = req.params;

   let video = await Video.findById(videoId);

   if (!video) {
      throw new ApiError(400, "No such video exists.");
   }

   if (video.videoFile && video.thumbnail) {
      await deleteFromCloudinary(retrievePublicIdFromUrl(video.thumbnail).trim());

      const response = await deleteFromCloudinary(
         retrievePublicIdFromUrl(video.videoFile)
      );
      console.log(response);
   }

   video = await Video.findByIdAndDelete(
      {
         _id: videoId,
      },
      {
         new: true,
      }
   );

   if (!video || !video.length) {
      throw new ApiError(400, "no such video exists to delete.");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, video, "Video deleted successfully."));
});

const togglePublishStatus = asyncHandler(async (req, res) => {
   const { videoId } = req.params;

   let video = await Video.findById(videoId);

   if (!video) {
      throw new ApiError(400, "No such video exists to toggle.");
   }

   video.isPublished = video.isPublished == true ? false : true;

   video = await video.save({ validateBeforeSave: false });

   return res
      .status(200)
      .json(new ApiResponse(200, video, "Video publicity toggled successfully."));
});

module.exports = {
   getAllVideos,
   publishAVideo,
   getVideo,
   updateVideoDetails,
   updateVideoThumbnail,
   deleteVideo,
   togglePublishStatus,
};
