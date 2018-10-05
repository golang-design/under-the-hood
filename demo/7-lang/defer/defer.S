TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/defer/defer.go
  defer.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  defer.go:3		0x104e029		483b6110		CMPQ 0x10(CX), SP			
  defer.go:3		0x104e02d		7661			JBE 0x104e090				
  defer.go:3		0x104e02f		4883ec28		SUBQ $0x28, SP				
  defer.go:3		0x104e033		48896c2420		MOVQ BP, 0x20(SP)			
  defer.go:3		0x104e038		488d6c2420		LEAQ 0x20(SP), BP			
  defer.go:4		0x104e03d		488d05a1d40100		LEAQ go.string.*+2565(SB), AX		
  defer.go:4		0x104e044		4889442410		MOVQ AX, 0x10(SP)			
  defer.go:4		0x104e049		48c74424180d000000	MOVQ $0xd, 0x18(SP)			
  defer.go:4		0x104e052		c7042410000000		MOVL $0x10, 0(SP)			
  defer.go:4		0x104e059		488d05500d0200		LEAQ go.func.*+71(SB), AX		
  defer.go:4		0x104e060		4889442408		MOVQ AX, 0x8(SP)			
  defer.go:4		0x104e065		e83629fdff		CALL runtime.deferproc(SB)		
  defer.go:4		0x104e06a		85c0			TESTL AX, AX				
  defer.go:4		0x104e06c		7512			JNE 0x104e080				
  defer.go:4		0x104e06e		eb00			JMP 0x104e070				
  defer.go:5		0x104e070		90			NOPL					
  defer.go:5		0x104e071		e8aa31fdff		CALL runtime.deferreturn(SB)		
  defer.go:5		0x104e076		488b6c2420		MOVQ 0x20(SP), BP			
  defer.go:5		0x104e07b		4883c428		ADDQ $0x28, SP				
  defer.go:5		0x104e07f		c3			RET					
  defer.go:4		0x104e080		90			NOPL					
  defer.go:4		0x104e081		e89a31fdff		CALL runtime.deferreturn(SB)		
  defer.go:4		0x104e086		488b6c2420		MOVQ 0x20(SP), BP			
  defer.go:4		0x104e08b		4883c428		ADDQ $0x28, SP				
  defer.go:4		0x104e08f		c3			RET					
  defer.go:3		0x104e090		e82b89ffff		CALL runtime.morestack_noctxt(SB)	
  defer.go:3		0x104e095		eb89			JMP main.main(SB)			
  :-1			0x104e097		cc			INT $0x3				
  :-1			0x104e098		cc			INT $0x3				
  :-1			0x104e099		cc			INT $0x3				
  :-1			0x104e09a		cc			INT $0x3				
  :-1			0x104e09b		cc			INT $0x3				
  :-1			0x104e09c		cc			INT $0x3				
  :-1			0x104e09d		cc			INT $0x3				
  :-1			0x104e09e		cc			INT $0x3				
  :-1			0x104e09f		cc			INT $0x3				
