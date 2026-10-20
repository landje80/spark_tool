-- AlterTable: de daadwerkelijk verzonden tekst van een outreach-mail bewaren (leeg voor mails van vóór deze kolom).
ALTER TABLE `EmailMessage` ADD COLUMN `textBody` MEDIUMTEXT NULL;
