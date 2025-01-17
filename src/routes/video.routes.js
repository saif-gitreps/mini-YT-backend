const router = require("express").Router();
const videoController = require("../controllers/video.controller");
const upload = require("../middlewares/multer.middleware");
const verifyJWT = require("../middlewares/auth.middleware");

router.route("/").get(videoController.getAllVideos);

router.use(verifyJWT);

router.route("/subscriptions").get(videoController.getSubscribedChannelsVideos);

router.route("/").post(
   upload.fields([
      {
         name: "thumbnail",
         maxCount: 1,
      },
      {
         name: "video",
         maxCount: 1,
      },
   ]),
   videoController.publishAVideo
);

router.route("/:videoId").get(videoController.getVideo);
router.route("/reel").get(videoController.getReelVideo);
router.route("/:videoId").delete(videoController.deleteVideo);
router
   .route("/:videoId")
   .patch(upload.single("thumbnail"), videoController.updateVideoThumbnail);

router.route("/update-details/:videoId").patch(videoController.updateVideoDetails);

router.route("/toggle/publish/:videoId").patch(videoController.togglePublishStatus);

module.exports = router;
