import unittest

import app


class BestQualitySelectionTests(unittest.TestCase):
    def test_best_quality_keeps_combined_selector_instead_of_downgrading_to_bestvideo(self):
        self.assertEqual(
            app.select_download_format(
                "bestvideo*+bestaudio/best",
                has_video=True,
                has_audio=True,
            ),
            "bestvideo*+bestaudio/best",
        )

    def test_video_only_choice_adds_best_audio_without_changing_video_format(self):
        self.assertEqual(
            app.select_download_format("120", has_video=True, has_audio=False),
            "120+bestaudio/best",
        )

    def test_merged_selector_uses_single_cookie_aware_ytdlp_path(self):
        self.assertFalse(
            app.should_use_legacy_split_download("bestvideo*+bestaudio/best")
        )


if __name__ == "__main__":
    unittest.main()
