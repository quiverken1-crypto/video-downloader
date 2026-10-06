import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class InstagramGalleryDlTests(unittest.TestCase):
    def test_parse_gallery_json_keeps_every_carousel_image(self):
        payload = [
            [2, {"count": 2, "description": "Violet chemistry"}],
            [3, "https://cdn.example/01.jpg", {
                "extension": "jpg", "num": 1, "owner_username": "selenagomez",
                "description": "Violet chemistry", "width": 1440, "height": 1800,
            }],
            [3, "https://cdn.example/02.jpg", {
                "extension": "jpg", "num": 2, "owner_username": "selenagomez",
                "description": "Violet chemistry", "width": 1440, "height": 1800,
            }],
        ]

        info = app.parse_gallery_dl_output(json.dumps(payload))

        self.assertEqual(info["media_count"], 2)
        self.assertEqual(info["uploader"], "selenagomez")
        self.assertEqual(info["thumbnail"], "https://cdn.example/01.jpg")
        self.assertEqual(info["title"], "Violet chemistry")

    def test_gallery_download_is_only_successful_when_media_files_exist(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir)

            def runner(command, **kwargs):
                (destination / "01.jpg").write_bytes(b"image")
                return subprocess.CompletedProcess(command, 0, "downloaded", "")

            result = app.download_instagram_with_gallery_dl(
                "https://www.instagram.com/p/EXAMPLE/",
                str(destination),
                runner=runner,
            )

            self.assertEqual([item.name for item in result], ["01.jpg"])

    def test_instagram_worker_skips_generic_ytdlp_preflight(self):
        fake_info = {
            "title": "Carousel",
            "uploader": "account",
            "thumbnail": "",
            "media_count": 1,
        }

        with tempfile.TemporaryDirectory() as temp_dir, \
                patch.object(app, "get_download_dir", return_value=temp_dir), \
                patch.object(app, "inspect_instagram_with_gallery_dl", return_value=fake_info), \
                patch.object(app, "download_instagram_with_gallery_dl") as download_gallery, \
                patch.object(app.yt_dlp, "YoutubeDL", side_effect=AssertionError("yt-dlp preflight used")):
            def make_media(_url, destination, **_kwargs):
                target = Path(destination) / "01.jpg"
                target.write_bytes(b"image")
                return [target]

            download_gallery.side_effect = make_media
            app.download_worker("ig-test", "https://www.instagram.com/p/EXAMPLE/", "best")

        self.assertEqual(app.download_progress["ig-test"]["status"], "done")

    def test_instagram_preview_returns_real_gallery_metadata(self):
        metadata = {
            "title": "Violet chemistry",
            "uploader": "selenagomez",
            "thumbnail": "https://cdn.example/01.jpg",
            "duration": 0,
            "media_count": 2,
            "records": [{}, {}],
        }
        with patch.object(app, "inspect_instagram_with_gallery_dl", return_value=metadata):
            response = app.app.test_client().post(
                "/preview",
                json={"url": "https://www.instagram.com/p/EXAMPLE/"},
            )

        body = response.get_json()
        self.assertEqual(body["title"], "Violet chemistry")
        self.assertEqual(body["uploader"], "selenagomez")
        self.assertEqual(body["playlist_count"], 2)


if __name__ == "__main__":
    unittest.main()
