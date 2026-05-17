package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	keysOnce   sync.Once
	keysErr    error

	dbKeys    []DBKey
	dbKeysMux sync.RWMutex
)

type DBKey struct {
	KeyID      string
	PrivateKey *rsa.PrivateKey
	PublicKey  *rsa.PublicKey
	ExpiresAt  time.Time
}

func privateKeyPath() string {
	if p := os.Getenv("JWT_PRIVATE_KEY_PATH"); p != "" {
		return p
	}

	candidates := []string{
		"keys/jwt-private.pem",
		"../keys/jwt-private.pem",
		filepath.Join("go-core", "keys", "jwt-private.pem"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "keys/jwt-private.pem"
}

func publicKeyPath() string {
	if p := os.Getenv("JWT_PUBLIC_KEY_PATH"); p != "" {
		return p
	}

	candidates := []string{
		"keys/jwt-public.pem",
		"../keys/jwt-public.pem",
		filepath.Join("go-core", "keys", "jwt-public.pem"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "keys/jwt-public.pem"
}

func initKeys() error {
	privateKeyBytes, err := os.ReadFile(privateKeyPath())
	if err != nil {
		return fmt.Errorf("failed to read private key: %w", err)
	}

	block, _ := pem.Decode(privateKeyBytes)
	if block == nil {
		return fmt.Errorf("failed to decode private key PEM")
	}

	if parsedPKCS8, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := parsedPKCS8.(*rsa.PrivateKey)
		if !ok {
			return fmt.Errorf("private key is not RSA")
		}
		privateKey = rsaKey
	} else {
		parsedPKCS1, parseErr := x509.ParsePKCS1PrivateKey(block.Bytes)
		if parseErr != nil {
			return fmt.Errorf("failed to parse private key (PKCS#8 or PKCS#1): %w", parseErr)
		}
		privateKey = parsedPKCS1
	}

	publicKeyBytes, err := os.ReadFile(publicKeyPath())
	if err != nil {
		return fmt.Errorf("failed to read public key: %w", err)
	}

	block, _ = pem.Decode(publicKeyBytes)
	if block == nil {
		return fmt.Errorf("failed to decode public key PEM")
	}

	parsedPubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse public key: %w", err)
	}

	var ok bool
	publicKey, ok = parsedPubKey.(*rsa.PublicKey)
	if !ok {
		return fmt.Errorf("not an RSA public key")
	}

	return nil
}

func InitKeys() error {
	keysOnce.Do(func() {
		keysErr = initKeys()
	})
	return keysErr
}

func GetPrivateKey() (*rsa.PrivateKey, error) {
	if err := InitKeys(); err != nil {
		return nil, err
	}
	return privateKey, nil
}

func GetPublicKey() (*rsa.PublicKey, error) {
	if err := InitKeys(); err != nil {
		return nil, err
	}
	return publicKey, nil
}

func GetJWKS(kid string) (map[string]any, error) {
	pub, err := GetPublicKey()
	if err != nil {
		return nil, err
	}

	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	eBytes := big.NewInt(int64(pub.E)).Bytes()
	e := base64.RawURLEncoding.EncodeToString(eBytes)

	return map[string]any{
		"keys": []map[string]string{
			{
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"kid": kid,
				"n":   n,
				"e":   e,
			},
		},
	}, nil
}

func LoadDBKeys(keys []DBKey) {
	dbKeysMux.Lock()
	defer dbKeysMux.Unlock()
	if len(keys) == 0 {
		return
	}

	merged := make(map[string]DBKey, len(dbKeys)+len(keys))
	for _, key := range dbKeys {
		merged[key.KeyID] = key
	}
	for _, key := range keys {
		merged[key.KeyID] = key
	}

	dbKeys = dbKeys[:0]
	for _, key := range merged {
		dbKeys = append(dbKeys, key)
	}
}

func GetActiveDBKey() (*DBKey, error) {
	dbKeysMux.RLock()
	defer dbKeysMux.RUnlock()

	now := time.Now()
	var newest *DBKey
	for i := range dbKeys {
		if !now.Before(dbKeys[i].ExpiresAt) {
			continue
		}
		if newest == nil || dbKeys[i].ExpiresAt.After(newest.ExpiresAt) {
			newest = &dbKeys[i]
		}
	}
	if newest != nil {
		return newest, nil
	}
	return nil, fmt.Errorf("no active signing key found")
}

func GetDBKeyByID(kid string) (*DBKey, error) {
	dbKeysMux.RLock()
	defer dbKeysMux.RUnlock()

	for i := range dbKeys {
		if dbKeys[i].KeyID == kid {
			return &dbKeys[i], nil
		}
	}
	return nil, fmt.Errorf("key not found: %s", kid)
}

func GenerateRSAKeyPair() (*rsa.PrivateKey, *rsa.PublicKey, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}
	return priv, &priv.PublicKey, nil
}

func EncodePrivateKeyPEM(key *rsa.PrivateKey) string {
	privBytes := x509.MarshalPKCS1PrivateKey(key)
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privBytes,
	})
	return string(privPEM)
}

func EncodePublicKeyPEM(key *rsa.PublicKey) (string, error) {
	pubBytes, err := x509.MarshalPKIXPublicKey(key)
	if err != nil {
		return "", err
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	})
	return string(pubPEM), nil
}

func DecodePrivateKeyPEM(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM")
	}

	if parsedPKCS8, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := parsedPKCS8.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("not RSA key")
		}
		return rsaKey, nil
	}

	return x509.ParsePKCS1PrivateKey(block.Bytes)
}

func DecodePublicKeyPEM(pemStr string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM")
	}

	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}

	rsaKey, ok := parsedKey.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("not RSA public key")
	}
	return rsaKey, nil
}
