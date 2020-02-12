TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/panic/main.go
  main.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:3		0x104e029		483b6110		CMPQ 0x10(CX), SP			
  main.go:3		0x104e02d		764a			JBE 0x104e079				
  main.go:3		0x104e02f		4883ec18		SUBQ $0x18, SP				
  main.go:3		0x104e033		48896c2410		MOVQ BP, 0x10(SP)			
  main.go:3		0x104e038		488d6c2410		LEAQ 0x10(SP), BP			
  main.go:4		0x104e03d		c7042400000000		MOVL $0x0, 0(SP)			
  main.go:4		0x104e044		488d05150d0200		LEAQ go.func.*+68(SB), AX		
  main.go:4		0x104e04b		4889442408		MOVQ AX, 0x8(SP)			
  main.go:4		0x104e050		e84b29fdff		CALL runtime.deferproc(SB)		
  main.go:4		0x104e055		85c0			TESTL AX, AX				
  main.go:4		0x104e057		7510			JNE 0x104e069				
  main.go:4		0x104e059		eb00			JMP 0x104e05b				
  main.go:7		0x104e05b		0f57c0			XORPS X0, X0				
  main.go:7		0x104e05e		0f110424		MOVUPS X0, 0(SP)			
  main.go:7		0x104e062		e8d935fdff		CALL runtime.gopanic(SB)		
  main.go:7		0x104e067		0f0b			UD2					
  main.go:4		0x104e069		90			NOPL					
  main.go:4		0x104e06a		e8b131fdff		CALL runtime.deferreturn(SB)		
  main.go:4		0x104e06f		488b6c2410		MOVQ 0x10(SP), BP			
  main.go:4		0x104e074		4883c418		ADDQ $0x18, SP				
  main.go:4		0x104e078		c3			RET					
  main.go:3		0x104e079		e84289ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:3		0x104e07e		eba0			JMP main.main(SB)			

TEXT main.main.func1(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/panic/main.go
  main.go:4		0x104e080		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:4		0x104e089		483b6110		CMPQ 0x10(CX), SP			
  main.go:4		0x104e08d		7626			JBE 0x104e0b5				
  main.go:4		0x104e08f		4883ec20		SUBQ $0x20, SP				
  main.go:4		0x104e093		48896c2418		MOVQ BP, 0x18(SP)			
  main.go:4		0x104e098		488d6c2418		LEAQ 0x18(SP), BP			
  main.go:5		0x104e09d		488d442428		LEAQ 0x28(SP), AX			
  main.go:5		0x104e0a2		48890424		MOVQ AX, 0(SP)				
  main.go:5		0x104e0a6		e8153bfdff		CALL runtime.gorecover(SB)		
  main.go:6		0x104e0ab		488b6c2418		MOVQ 0x18(SP), BP			
  main.go:6		0x104e0b0		4883c420		ADDQ $0x20, SP				
  main.go:6		0x104e0b4		c3			RET					
  main.go:4		0x104e0b5		e80689ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:4		0x104e0ba		ebc4			JMP main.main.func1(SB)			
  :-1			0x104e0bc		cc			INT $0x3				
  :-1			0x104e0bd		cc			INT $0x3				
  :-1			0x104e0be		cc			INT $0x3				
  :-1			0x104e0bf		cc			INT $0x3				
