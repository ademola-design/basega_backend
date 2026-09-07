-- ============================================================
-- BASEGA Alumni Association — MySQL Database Schema
-- Run this file once on your qserver.ng MySQL database
-- ============================================================

CREATE DATABASE IF NOT EXISTS basega_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE basega_db;

-- ============================================================
-- MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(20)   DEFAULT NULL,
  first_name    VARCHAR(100)  NOT NULL,
  last_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  phone         VARCHAR(20)   DEFAULT NULL,
  gender        VARCHAR(20)   DEFAULT NULL,
  dob           DATE          DEFAULT NULL,
  city          VARCHAR(100)  DEFAULT NULL,
  state         VARCHAR(100)  DEFAULT NULL,
  class_set     INT           DEFAULT NULL,
  student_id    VARCHAR(50)   DEFAULT NULL,
  house         VARCHAR(100)  DEFAULT NULL,
  class_teacher VARCHAR(100)  DEFAULT NULL,
  waec_num      VARCHAR(50)   DEFAULT NULL,
  referee       VARCHAR(150)  DEFAULT NULL,
  profession    VARCHAR(150)  DEFAULT NULL,
  company       VARCHAR(150)  DEFAULT NULL,
  industry      VARCHAR(100)  DEFAULT NULL,
  linkedin      VARCHAR(255)  DEFAULT NULL,
  bio           TEXT          DEFAULT NULL,
  photo_url     VARCHAR(255)  DEFAULT NULL,
  status        ENUM('pending','approved','rejected','financial','inactive') DEFAULT 'pending',
  role          ENUM('member','admin') DEFAULT 'member',
  ref_number    VARCHAR(30)   DEFAULT NULL,
  referral_src  VARCHAR(100)  DEFAULT NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(200)  NOT NULL,
  description TEXT          DEFAULT NULL,
  event_date  DATE          NOT NULL,
  location    VARCHAR(200)  DEFAULT NULL,
  type        VARCHAR(50)   DEFAULT 'General',
  image_url   VARCHAR(255)  DEFAULT NULL,
  created_by  INT           DEFAULT NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL
);

-- ============================================================
-- NEWS / ARTICLES
-- ============================================================
CREATE TABLE IF NOT EXISTS news (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(250)  NOT NULL,
  excerpt    TEXT          DEFAULT NULL,
  body       LONGTEXT      DEFAULT NULL,
  category   VARCHAR(100)  DEFAULT 'General',
  image_url  VARCHAR(255)  DEFAULT NULL,
  author_id  INT           DEFAULT NULL,
  status     ENUM('draft','published') DEFAULT 'published',
  created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL
);

-- ============================================================
-- GALLERY
-- ============================================================
CREATE TABLE IF NOT EXISTS gallery (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  image_url   VARCHAR(255)  NOT NULL,
  caption     VARCHAR(255)  DEFAULT NULL,
  uploaded_by INT           DEFAULT NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES members(id) ON DELETE SET NULL
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  member_id       INT           NOT NULL,
  type            ENUM('annual','building','scholarship','event') NOT NULL,
  amount          DECIMAL(10,2) NOT NULL,
  paystack_ref    VARCHAR(150)  DEFAULT NULL,
  status          ENUM('pending','confirmed','failed') DEFAULT 'pending',
  payment_year    INT           DEFAULT NULL,
  payment_date    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- ============================================================
-- NOMINATIONS (Alumni of the Month)
-- ============================================================
-- Only ONE nomination per month_year may hold status='selected'. MySQL cannot
-- express that as a partial unique index, so it is enforced in a transaction
-- in routes/nominations.js (PUT /:id/select).
CREATE TABLE IF NOT EXISTS nominations (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  nominee_name      VARCHAR(200)  NOT NULL,
  nominee_member_id INT           DEFAULT NULL,
  nominator_id      INT           DEFAULT NULL,
  reason            TEXT          DEFAULT NULL,
  month_year        VARCHAR(20)   DEFAULT NULL,
  status            ENUM('pending','selected','rejected') DEFAULT 'pending',
  created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (nominee_member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (nominator_id)      REFERENCES members(id) ON DELETE SET NULL,
  INDEX idx_nominations_status_month (status, month_year)
);

-- ============================================================
-- ACTIVITY LOG (Admin dashboard feed)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  member_id   INT           DEFAULT NULL,
  action      VARCHAR(255)  NOT NULL,
  meta        TEXT          DEFAULT NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

-- ============================================================
-- MESSAGES (Contact form submissions)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sender_name VARCHAR(150)  NOT NULL,
  email       VARCHAR(150)  NOT NULL,
  subject     VARCHAR(250)  DEFAULT NULL,
  body        TEXT          NOT NULL,
  is_read     TINYINT(1)    DEFAULT 0,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SEED: Default admin account
-- The password hash below was generated with bcrypt (12 rounds).
-- Fix #3: The plaintext password has been removed from this file.
-- Change the admin password immediately after first login via
-- the Change Password screen, or via PUT /api/auth/change-password.
-- ============================================================
INSERT INTO members (
  first_name, last_name, email, password_hash,
  status, role, class_set, profession
) VALUES (
  'BASEGA', 'Admin',
  'admin@basegaalumni.ng',
  '$2a$12$GjFkE0v5n2yXQJ2W9vNp8.3zHLX1mYkXDe4pQrOFe9sKlUmTcBuGe',
  'approved', 'admin', 2000, 'Administrator'
);

-- ============================================================
-- PASSWORD RESET TOKENS
-- Tokens are single-use and expire after 1 hour
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  member_id  INT          NOT NULL,
  token      VARCHAR(64)  NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  used       TINYINT(1)   DEFAULT 0,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
