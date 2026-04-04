import hashlib
import base64
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding
from config import SECRET_KEY

def get_aes_key():
    return hashlib.sha256(SECRET_KEY.encode()).digest()

def get_cipher_at_offset(nonce: bytes, offset: int):
    """Returns AES-CTR cipher perfectly initialized at the given byte offset."""
    key = get_aes_key()
    int_nonce = int.from_bytes(nonce, byteorder='big')
    block_offset = offset // 16
    new_counter_int = (int_nonce + block_offset) % (1 << 128)
    new_nonce = new_counter_int.to_bytes(16, byteorder='big')
    
    return Cipher(algorithms.AES(key), modes.CTR(new_nonce), backend=default_backend())

def process_chunk(data: bytes, nonce: bytes, offset: int = 0) -> bytes:
    """Encrypts/Decrypts an isolated chunk symmetric to the offset."""
    cipher = get_cipher_at_offset(nonce, offset)
    encryptor = cipher.encryptor()
    
    remainder = offset % 16
    if remainder > 0:
        encryptor.update(b'\x00' * remainder)
        
    return encryptor.update(data)

class VaultDecryptor:
    def __init__(self, nonce: bytes, offset: int):
        cipher = get_cipher_at_offset(nonce, offset)
        self.decryptor = cipher.decryptor()
        
        remainder = offset % 16
        if remainder > 0:
            # We must sync the AES-CTR counter but discard the 'mask' bytes
            # that were meant for the previous bytes in the block.
            self.decryptor.update(b'\x00' * remainder)
            
    def update(self, data: bytes) -> bytes:
        return self.decryptor.update(data)
        
    def finalize(self) -> bytes:
        return self.decryptor.finalize()

def get_stream_decryptor(nonce: bytes, offset: int):
    """Returns a continuous stream decryptor initialized exactly at the byte offset."""
    return VaultDecryptor(nonce, offset)

def encrypt_filename(filename: str) -> str:
    """Deterministically encrypt a filename and make it URL safe with no extensions."""
    key = get_aes_key()
    padder = padding.PKCS7(128).padder()
    padded_data = padder.update(filename.encode()) + padder.finalize()
    
    cipher = Cipher(algorithms.AES(key), modes.ECB(), backend=default_backend())
    encryptor = cipher.encryptor()
    enc = encryptor.update(padded_data) + encryptor.finalize()
    
    return base64.urlsafe_b64encode(enc).decode().rstrip("=")

def decrypt_filename(enc_string: str) -> str:
    """Decrypt the filename obfuscation."""
    key = get_aes_key()
    # add missing padding
    padded_b64 = enc_string + "=" * ((4 - len(enc_string) % 4) % 4)
    raw_enc = base64.urlsafe_b64decode(padded_b64)
    
    cipher = Cipher(algorithms.AES(key), modes.ECB(), backend=default_backend())
    decryptor = cipher.decryptor()
    dec_padded = decryptor.update(raw_enc) + decryptor.finalize()
    
    unpadder = padding.PKCS7(128).unpadder()
    dec = unpadder.update(dec_padded) + unpadder.finalize()
    
    return dec.decode()

