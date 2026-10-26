CREATE TABLE IF NOT EXISTS news_media (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  news_id    INT           NOT NULL,
  media_type ENUM('image','video') NOT NULL,
  url        VARCHAR(1000) NOT NULL,
  sort_order INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_news_media_news_type_order (news_id, media_type, sort_order),
  FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
);
