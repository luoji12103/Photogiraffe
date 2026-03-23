FROM golang:1.25-alpine AS builder
RUN apk add --no-cache tzdata git
WORKDIR /app
COPY . .
RUN go mod tidy && go build -o main .

FROM alpine:latest
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=builder /app/main .
COPY --from=builder /app/keys ./keys
EXPOSE 8080
CMD ["./main"]