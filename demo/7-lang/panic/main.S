TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/panic/main.go
  main.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:3		0x104e029		483b6110		CMPQ 0x10(CX), SP			
  main.go:3		0x104e02d		761c			JBE 0x104e04b				
  main.go:3		0x104e02f		4883ec18		SUBQ $0x18, SP				
  main.go:3		0x104e033		48896c2410		MOVQ BP, 0x10(SP)			
  main.go:3		0x104e038		488d6c2410		LEAQ 0x10(SP), BP			
  main.go:4		0x104e03d		0f57c0			XORPS X0, X0				
  main.go:4		0x104e040		0f110424		MOVUPS X0, 0(SP)			
  main.go:4		0x104e044		e8f735fdff		CALL runtime.gopanic(SB)		
  main.go:4		0x104e049		0f0b			UD2					
  main.go:3		0x104e04b		e87089ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:3		0x104e050		ebce			JMP main.main(SB)			
  :-1			0x104e052		cc			INT $0x3				
  :-1			0x104e053		cc			INT $0x3				
  :-1			0x104e054		cc			INT $0x3				
  :-1			0x104e055		cc			INT $0x3				
  :-1			0x104e056		cc			INT $0x3				
  :-1			0x104e057		cc			INT $0x3				
  :-1			0x104e058		cc			INT $0x3				
  :-1			0x104e059		cc			INT $0x3				
  :-1			0x104e05a		cc			INT $0x3				
  :-1			0x104e05b		cc			INT $0x3				
  :-1			0x104e05c		cc			INT $0x3				
  :-1			0x104e05d		cc			INT $0x3				
  :-1			0x104e05e		cc			INT $0x3				
  :-1			0x104e05f		cc			INT $0x3				
