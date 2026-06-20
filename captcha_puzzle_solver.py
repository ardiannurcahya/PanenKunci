import cv2


class PuzzleCaptchaSolver:
    def __init__(self, gap_image_path, bg_image_path, output_image_path):
        self.gap_image_path = gap_image_path
        self.bg_image_path = bg_image_path
        self.output_image_path = output_image_path

    def remove_whitespace(self, image_path):
        """
        This method removes whitespace from an image by cropping to the bounding box of the largest object (the puzzle piece).
        This ignores 1px borders or edge noise captured by screenshots.
        """
        img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError(f"Could not read image: {image_path}")

        # Extract single channel representation for thresholding
        if len(img.shape) == 3 and img.shape[2] == 4:
            # Use Alpha channel if transparent
            gray = img[:, :, 3]
        elif len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img

        # Threshold to get a binary mask
        _, thresh = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)

        # Invert if the background is white
        h_img, w_img = gray.shape[:2]
        corners = [gray[0, 0], gray[0, w_img-1], gray[h_img-1, 0], gray[h_img-1, w_img-1]]
        if sum(corners) / 4 > 240:
            _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

        # Find contours to locate the puzzle piece (largest contour)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest_contour = max(contours, key=cv2.contourArea)
            # Minimum area check to avoid matching noise
            if cv2.contourArea(largest_contour) > 20:
                x, y, w, h = cv2.boundingRect(largest_contour)
                cropped = img[y:y+h, x:x+w]
                if len(cropped.shape) == 3 and cropped.shape[2] == 4:
                    return cropped[:, :, :3]
                return cropped

        # Fallback to simple bounding box if no contours found
        coords = cv2.findNonZero(thresh)
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            cropped = img[y:y+h, x:x+w]
            if len(cropped.shape) == 3 and cropped.shape[2] == 4:
                return cropped[:, :, :3]
            return cropped

        return img

    def apply_edge_detection(self, img):
        """
        Applies edge detection on the given image.

        :param img: The input image.
        :return: The image with edges highlighted.
        """
        grayscale_img = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(grayscale_img, 100, 200)
        edges_rgb = cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB)
        return edges_rgb

    def find_position_of_slide(self, slide_pic, background_pic):
        """
        Find the position of the slide on the background picture.

        :param slide_pic: The slide picture to find.
        :type slide_pic: numpy.ndarray
        :param background_pic: The background picture to search in.
        :type background_pic: numpy.ndarray
        :return: The x-coordinate of the top-left corner of the slide in the background picture.
        :rtype: int
        """
        tpl_height, tpl_width = slide_pic.shape[:2]
        result = cv2.matchTemplate(background_pic, slide_pic, cv2.TM_CCOEFF_NORMED)
        
        # Ignore matches in the left-most region (X < 60) to avoid matching the starting piece
        if result.shape[1] > 60:
            result[:, :60] = -1
            
        _, _, _, max_loc = cv2.minMaxLoc(result)
        tl = max_loc
        br = (tl[0] + tpl_width, tl[1] + tpl_height)
        cv2.rectangle(background_pic, tl, br, (0, 0, 255), 2)
        cv2.imwrite(self.output_image_path, background_pic)
        return tl[0]

    def discern(self):
        """
        Performs the discernment process to find the position of the slide in the given images.

        :return: The position of the slide in the images.
        """
        import sys
        # We need to find piece_start_x from the gap image
        gap_image = cv2.imread(self.gap_image_path, cv2.IMREAD_UNCHANGED)
        piece_start_x = 0
        if gap_image is not None:
            # Extract channel
            if len(gap_image.shape) == 3 and gap_image.shape[2] == 4:
                gray = gap_image[:, :, 3]
            elif len(gap_image.shape) == 3:
                gray = cv2.cvtColor(gap_image, cv2.COLOR_BGR2GRAY)
            else:
                gray = gap_image
            _, thresh = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest_contour = max(contours, key=cv2.contourArea)
                if cv2.contourArea(largest_contour) > 20:
                    x, y, w, h = cv2.boundingRect(largest_contour)
                    piece_start_x = x
                    print(f"Detected puzzle piece starting X in gap image: {piece_start_x}px", file=sys.stderr)
        
        # Now get the cropped gap image and find shadow in bg
        cropped_gap = self.remove_whitespace(self.gap_image_path)
        edge_detected_gap = self.apply_edge_detection(cropped_gap)
        bg_image = cv2.imread(self.bg_image_path, 1)
        edge_detected_bg = self.apply_edge_detection(bg_image)
        shadow_x = self.find_position_of_slide(edge_detected_gap, edge_detected_bg)
        
        # Relative distance is shadow_x - piece_start_x
        relative_distance = shadow_x - piece_start_x
        print(f"Absolute shadow X: {shadow_x}px, piece start X: {piece_start_x}px", file=sys.stderr)
        print(f"Relative drag distance: {relative_distance}px", file=sys.stderr)
        
        return relative_distance


if __name__ == "__main__":
    import sys

    if len(sys.argv) >= 3:
        gap_path = sys.argv[1]
        bg_path = sys.argv[2]
        output_path = sys.argv[3] if len(sys.argv) > 3 else "captcha_result.png"
    else:
        gap_path = "demo/geetest4/1_slice.png"
        bg_path = "demo/geetest4/1_bg.png"
        output_path = "demo/geetest4/1_result.png"

    solver = PuzzleCaptchaSolver(
        gap_image_path=gap_path,
        bg_image_path=bg_path,
        output_image_path=output_path
    )
    position = solver.discern()
    print(f"The position of the slide is: {position}")