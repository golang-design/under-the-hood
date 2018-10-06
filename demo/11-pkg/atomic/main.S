TEXT sync/atomic.CompareAndSwapUintptr(SB) /usr/local/Cellar/go/1.11/libexec/src/sync/atomic/asm.s
  asm.s:31		0x1001070		e91b0b0000		JMP runtime/internal/atomic.Casuintptr(SB)	
  :-1			0x1001075		cc			INT $0x3					
  :-1			0x1001076		cc			INT $0x3					
  :-1			0x1001077		cc			INT $0x3					
  :-1			0x1001078		cc			INT $0x3					
  :-1			0x1001079		cc			INT $0x3					
  :-1			0x100107a		cc			INT $0x3					
  :-1			0x100107b		cc			INT $0x3					
  :-1			0x100107c		cc			INT $0x3					
  :-1			0x100107d		cc			INT $0x3					
  :-1			0x100107e		cc			INT $0x3					
  :-1			0x100107f		cc			INT $0x3					

TEXT runtime/internal/atomic.Casuintptr(SB) /usr/local/Cellar/go/1.11/libexec/src/runtime/internal/atomic/asm_amd64.s
  asm_amd64.s:44	0x1001b90		e9dbffffff		JMP runtime/internal/atomic.Cas64(SB)	
  :-1			0x1001b95		cc			INT $0x3				
  :-1			0x1001b96		cc			INT $0x3				
  :-1			0x1001b97		cc			INT $0x3				
  :-1			0x1001b98		cc			INT $0x3				
  :-1			0x1001b99		cc			INT $0x3				
  :-1			0x1001b9a		cc			INT $0x3				
  :-1			0x1001b9b		cc			INT $0x3				
  :-1			0x1001b9c		cc			INT $0x3				
  :-1			0x1001b9d		cc			INT $0x3				
  :-1			0x1001b9e		cc			INT $0x3				
  :-1			0x1001b9f		cc			INT $0x3				
