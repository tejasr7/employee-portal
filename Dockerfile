FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "node seed.js && node import_attendance.js && node server.js"]
