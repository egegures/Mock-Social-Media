#!/usr/bin/env python

import random
import os

CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
result = ''.join([random.choice(CHARS) for _ in range(16)])
print(result)
status = os.system(f'wl-copy {result}')
if status != 0:
    print('Warning: needs wl-copy to copy to clipboard')