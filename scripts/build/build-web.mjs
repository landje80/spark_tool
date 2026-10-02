// Bouwt de frontend (dist/web) altijd als productiebuild.
//
// `vite build` erft NODE_ENV uit de omgeving. Een lokale .env met NODE_ENV=development (die
// `npm run verify` injecteert) leverde zo een dist/web met de ontwikkelversie van React op
// (~668 kB i.p.v. ~348 kB). Door NODE_ENV hier vóór het laden van Vite vast te zetten is de
// build deterministisch, ongeacht de omringende omgeving.
process.env.NODE_ENV = 'production';

const { build } = await import('vite');
await build();
