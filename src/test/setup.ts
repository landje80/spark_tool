import 'dotenv/config';

// Integratietests draaien uitsluitend op de aparte testdatabase (naam moet op _test eindigen).
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ontbreekt (zie .env.example)');
if (!/_test$/.test(new URL(url).pathname.slice(1))) {
  throw new Error(
    'TEST_DATABASE_URL moet naar een database wijzen waarvan de naam op _test eindigt',
  );
}
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
